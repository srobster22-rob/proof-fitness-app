import ExpoModulesCore
import Foundation

/*
 Expo Modules API bridge. Drop this into modules/recap-exporter/ios/ in the app.

 The whole workout is sent across the bridge ONCE as a record, and native draws
 every frame. The alternative — rendering overlay frames in JS and shipping
 bitmaps down — would push 180 x 8 MB per export through the bridge, which is a
 non-starter. The cost of this choice is that recap.js and RecapRenderer.swift
 must be kept in sync by hand.
*/

struct LiftRecord: Record {
  @Field var name: String = ""
  @Field var load: String = ""
  @Field var isPR: Bool = false
}

struct RecapOptions: Record {
  @Field var title: String = "WORKOUT"
  @Field var date: String = ""
  @Field var volume: Int = 0
  @Field var sets: Int = 0
  @Field var duration: String = ""
  @Field var streak: Int = 0
  @Field var prLift: String? = nil
  @Field var prWeight: Int = 0
  @Field var prReps: Int = 0
  @Field var prPrev: Int = 0
  @Field var lifts: [LiftRecord] = []
  @Field var watermark: String = ""
  /// file:// URL of a clip from the camera roll. Omit for a data-only recap.
  @Field var clipUri: String? = nil
}

public class RecapExporterModule: Module {
  private var exporter: RecapExporter?

  public func definition() -> ModuleDefinition {
    Name("RecapExporter")

    Events("onProgress")

    AsyncFunction("export") { (options: RecapOptions, promise: Promise) in
      let exporter = RecapExporter()
      self.exporter = exporter

      let data = RecapData(
        title: options.title,
        date: options.date,
        volume: options.volume,
        sets: options.sets,
        duration: options.duration,
        streak: options.streak,
        prLift: options.prLift,
        prWeight: options.prWeight,
        prReps: options.prReps,
        prPrev: options.prPrev,
        lifts: options.lifts.map { ($0.name, $0.load, $0.isPR) },
        watermark: options.watermark
      )

      let clipURL = options.clipUri.flatMap { URL(string: $0) }

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let started = CFAbsoluteTimeGetCurrent()
          let url = try exporter.export(data: data, clipURL: clipURL) { p in
            self.sendEvent("onProgress", ["progress": p])
          }
          promise.resolve([
            "uri": url.absoluteString,
            "elapsedMs": Int((CFAbsoluteTimeGetCurrent() - started) * 1000)
          ])
        } catch {
          promise.reject("ERR_RECAP_EXPORT", error.localizedDescription)
        }
      }
    }

    Function("cancel") {
      self.exporter?.cancel()
    }
  }
}
