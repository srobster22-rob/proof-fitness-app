import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation

/*
 RecapExporter — writes a 1080x1920 H.264 MP4 of the workout recap, optionally
 composited over a clip the user picked from their camera roll.

 Architecture note. The obvious Apple path is AVMutableVideoComposition plus
 AVVideoCompositionCoreAnimationTool, which lets you hand AVFoundation a CALayer
 tree and have it composite during export. We deliberately do NOT use it:

   - it has a long-standing record of hanging the export indefinitely, with no
     error and no progress, on a subset of devices;
   - during export it only animates a fixed set of CALayer properties and
     silently ignores custom ones, so animation has to be authored around its
     quirks rather than around the design;
   - it gives no control over per-frame cost, which is the thing we care about.

 Instead this is an explicit AVAssetReader -> CGContext -> AVAssetWriter loop.
 More code, but every frame is ours: deterministic, cancellable, measurable, and
 it degrades predictably on old hardware. Frames are drawn with CoreGraphics via
 RecapRenderer, which is a direct port of spike/recap.js.
*/

public struct RecapData {
  public var title: String
  public var date: String
  public var volume: Int
  public var sets: Int
  public var duration: String
  public var streak: Int
  public var prLift: String?
  public var prWeight: Int
  public var prReps: Int
  public var prPrev: Int
  public var lifts: [(name: String, load: String, isPR: Bool)]
  public var watermark: String
}

public enum RecapExportError: Error {
  case noVideoTrack
  case writerSetupFailed(String)
  case pixelBufferPoolUnavailable
  case contextCreationFailed
  case cancelled
  case writerFailed(String)
}

public final class RecapExporter {

  public static let width = 1080
  public static let height = 1920
  public static let fps: Int32 = 30
  public static let duration: Double = 6.0

  private var cancelled = false
  public func cancel() { cancelled = true }

  /// - Parameters:
  ///   - clipURL: optional camera-roll clip to composite underneath.
  ///   - progress: 0...1 on an arbitrary queue.
  /// - Returns: file URL of the written .mp4 in the temporary directory.
  public func export(data: RecapData,
                     clipURL: URL?,
                     progress: ((Double) -> Void)? = nil) throws -> URL {

    let outURL = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("recap-\(UUID().uuidString).mp4")

    // ---- writer -----------------------------------------------------------
    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)

    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Self.width,
      AVVideoHeightKey: Self.height,
      AVVideoCompressionPropertiesKey: [
        // ~10 Mbps keeps 1080x1920 crisp after the platform re-encodes it.
        AVVideoAverageBitRateKey: 10_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: Int(Self.fps)
      ]
    ]

    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    input.expectsMediaDataInRealTime = false

    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: Self.width,
        kCVPixelBufferHeightKey as String: Self.height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:]
      ])

    guard writer.canAdd(input) else { throw RecapExportError.writerSetupFailed("canAdd == false") }
    writer.add(input)
    guard writer.startWriting() else {
      throw RecapExportError.writerSetupFailed(writer.error?.localizedDescription ?? "startWriting")
    }
    writer.startSession(atSourceTime: .zero)

    // ---- optional source clip ---------------------------------------------
    var source: ClipSource?
    if let clipURL { source = try ClipSource(url: clipURL) }

    let renderer = RecapRenderer(width: Self.width, height: Self.height)
    let totalFrames = Int(Self.duration * Double(Self.fps))

    let queue = DispatchQueue(label: "recap.export")
    let done = DispatchSemaphore(value: 0)
    var thrown: Error?
    var frame = 0

    input.requestMediaDataWhenReady(on: queue) {
      while input.isReadyForMoreMediaData {
        if self.cancelled { thrown = RecapExportError.cancelled; input.markAsFinished(); done.signal(); return }
        if frame >= totalFrames { input.markAsFinished(); done.signal(); return }

        let t = Double(frame) / Double(Self.fps)
        let time = CMTime(value: CMTimeValue(frame), timescale: Self.fps)

        // Each frame allocates a pixel buffer and, when compositing, a CGImage
        // decoded from the source clip. Without draining per iteration the pool
        // holds all 180 and the export gets jetsammed on older devices.
        var frameError: Error?
        autoreleasepool {
        do {
          guard let pool = adaptor.pixelBufferPool else {
            throw RecapExportError.pixelBufferPoolUnavailable
          }
          var pb: CVPixelBuffer?
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
          guard let buffer = pb else { throw RecapExportError.pixelBufferPoolUnavailable }

          CVPixelBufferLockBaseAddress(buffer, [])
          guard let ctx = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: Self.width,
            height: Self.height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
              | CGBitmapInfo.byteOrder32Little.rawValue
          ) else {
            CVPixelBufferUnlockBaseAddress(buffer, [])
            throw RecapExportError.contextCreationFailed
          }

          // CoreGraphics is bottom-left origin; recap.js is top-left. Flip once
          // here so every coordinate in RecapRenderer matches the JS reference.
          ctx.translateBy(x: 0, y: CGFloat(Self.height))
          ctx.scaleBy(x: 1, y: -1)

          let underlay = source?.frame(at: t)
          renderer.draw(in: ctx, t: t, data: data, underlay: underlay)

          // Unlock before handing the buffer to the encoder, not after.
          CVPixelBufferUnlockBaseAddress(buffer, [])

          if !adaptor.append(buffer, withPresentationTime: time) {
            throw RecapExportError.writerFailed(
              writer.error?.localizedDescription ?? "append failed at frame \(frame)")
          }
          frame += 1
          progress?(Double(frame) / Double(totalFrames))
        } catch {
          frameError = error
        }
        }  // autoreleasepool

        if let frameError {
          thrown = frameError
          input.markAsFinished()
          done.signal()
          return
        }
      }
    }

    done.wait()
    if let thrown { writer.cancelWriting(); throw thrown }

    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()

    if writer.status != .completed {
      throw RecapExportError.writerFailed(writer.error?.localizedDescription ?? "status \(writer.status.rawValue)")
    }
    return outURL
  }
}

// MARK: - Reading the imported clip

/// Pulls frames from the user's clip in presentation order.
///
/// Two real-world traps handled here: iPhone portrait video usually arrives
/// landscape-with-a-rotation-transform, and the clip's frame rate rarely matches
/// ours, so we hold the most recent frame until the source advances past `t`.
final class ClipSource {
  private let reader: AVAssetReader
  private let output: AVAssetReaderTrackOutput
  private var pending: (image: CGImage, time: Double)?
  private var exhausted = false
  let transform: CGAffineTransform
  let naturalSize: CGSize

  init(url: URL) throws {
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw RecapExportError.noVideoTrack
    }
    transform = track.preferredTransform
    naturalSize = track.naturalSize

    reader = try AVAssetReader(asset: asset)
    output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    reader.startReading()
  }

  /// Orientation-corrected display size.
  var displaySize: CGSize {
    let r = naturalSize.applying(transform)
    return CGSize(width: abs(r.width), height: abs(r.height))
  }

  func frame(at t: Double) -> (image: CGImage, transform: CGAffineTransform, size: CGSize)? {
    while !exhausted && (pending == nil || pending!.time < t) {
      guard let sample = output.copyNextSampleBuffer() else { exhausted = true; break }
      let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
      if let pb = CMSampleBufferGetImageBuffer(sample),
         let img = Self.cgImage(from: pb) {
        pending = (img, pts)
      }
    }
    guard let p = pending else { return nil }
    return (p.image, transform, displaySize)
  }

  private static func cgImage(from pb: CVPixelBuffer) -> CGImage? {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
    let ctx = CGContext(
      data: base,
      width: CVPixelBufferGetWidth(pb),
      height: CVPixelBufferGetHeight(pb),
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        | CGBitmapInfo.byteOrder32Little.rawValue)
    return ctx?.makeImage()
  }
}
