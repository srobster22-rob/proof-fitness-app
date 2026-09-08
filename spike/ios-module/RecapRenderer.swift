import CoreGraphics
import CoreText
import Foundation

/*
 RecapRenderer — CoreGraphics port of spike/recap.js.

 The JS file is the design source of truth: iterate there (instant feedback,
 renders in Node and in a browser), then port. Coordinates are top-left origin
 and identical between the two, because RecapExporter flips the context once
 before calling in. Keep them in sync — a divergence here means what the user
 previewed is not what gets exported.
*/
final class RecapRenderer {

  let W: CGFloat
  let H: CGFloat

  // Host apps (TikTok, Reels, Shorts) draw their own chrome over the video.
  // Full-bleed art is fine; anything that must be READ stays inside these.
  let safeTop: CGFloat = 200
  var safeBottom: CGFloat { H - 360 }
  let margin: CGFloat = 84
  var rail: CGFloat { W - 200 }      // right edge clear of the action rail

  private let volt = CGColor(red: 0.80, green: 1.0, blue: 0.0, alpha: 1)
  private let white = CGColor(gray: 1, alpha: 1)
  private let muted = CGColor(red: 0.486, green: 0.529, blue: 0.573, alpha: 1)
  private let bg = CGColor(red: 0.031, green: 0.035, blue: 0.039, alpha: 1)

  // The shipped app must bundle these — "Arial Black" does not exist on iOS.
  private let display = "Archivo-Black"
  private let ui = "Inter-SemiBold"

  init(width: Int, height: Int) {
    W = CGFloat(width); H = CGFloat(height)
  }

  // MARK: easing (must match recap.js exactly)
  private func outExpo(_ t: Double) -> Double { t >= 1 ? 1 : 1 - pow(2, -10 * t) }
  private func outCubic(_ t: Double) -> Double { 1 - pow(1 - t, 3) }
  private func seg(_ t: Double, _ a: Double, _ b: Double) -> Double {
    min(max((t - a) / (b - a), 0), 1)
  }

  func draw(in ctx: CGContext,
            t: Double,
            data: RecapData,
            underlay: (image: CGImage, transform: CGAffineTransform, size: CGSize)?) {

    ctx.setFillColor(CGColor(gray: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

    drawBase(ctx, underlay: underlay)

    // header rule sweep
    ctx.setFillColor(volt)
    ctx.fill(CGRect(x: margin, y: 250, width: (W - margin * 2) * outExpo(seg(t, 0.05, 0.75)), height: 7))

    riseText(ctx, data.title, x: margin, y: 224, size: 62,
             p: seg(t, 0.12, 0.75), font: display, color: white, track: 5)

    let dp = seg(t, 0.3, 0.9)
    if dp > 0 {
      text(ctx, data.date, x: W - margin, y: 224, size: 34,
           font: ui, color: muted, alpha: dp, align: .right)
    }

    // hero: total volume
    riseText(ctx, "TOTAL VOLUME", x: margin, y: 400, size: 32,
             p: seg(t, 0.4, 0.95), font: ui, color: muted, track: 7)

    let vp = seg(t, 0.45, 2.15)
    if vp > 0 {
      let shown = commas(Int((Double(data.volume) * outExpo(vp)).rounded()))
      let a = min(1, vp * 3)
      let w = text(ctx, shown, x: margin - 10, y: 600, size: 230,
                   font: display, color: white, alpha: a, align: .left)
      _ = text(ctx, "LB", x: margin + w + 18, y: 600, size: 64,
               font: display, color: volt, alpha: a, align: .left)
    }

    // stat cells
    let cells: [(String, String)] = [
      ("SETS", "\(data.sets)"), ("TIME", data.duration), ("STREAK", "\(data.streak) WK")
    ]
    for (i, cell) in cells.enumerated() {
      let p = seg(t, 1.0 + Double(i) * 0.12, 1.6 + Double(i) * 0.12)
      if p <= 0 { continue }
      let x = margin + CGFloat(i) * ((W - margin * 2) / 3)
      _ = text(ctx, cell.0, x: x, y: 700, size: 26, font: ui, color: muted, alpha: p, align: .left)
      riseText(ctx, cell.1, x: x, y: 772, size: 60, p: p, font: display, color: white, track: 0)
    }

    // PR slab
    if let prLift = data.prLift {
      let pp = seg(t, 2.25, 3.1)
      if pp > 0 {
        let y: CGFloat = 850
        ctx.saveGState()
        ctx.setAlpha(CGFloat(pp))
        ctx.setFillColor(volt)
        ctx.fill(CGRect(x: margin, y: y, width: (rail - margin) * outExpo(pp), height: 176))
        ctx.restoreGState()

        let inner = seg(t, 2.5, 3.2)
        if inner > 0 {
          ctx.saveGState()
          ctx.clip(to: CGRect(x: margin, y: y, width: rail - margin, height: 176))
          let black = CGColor(gray: 0, alpha: 1)
          _ = text(ctx, "NEW PERSONAL RECORD", x: margin + 34, y: y + 58, size: 27,
                   font: ui, color: black, alpha: inner, align: .left, track: 5)
          _ = text(ctx, "\(data.prWeight) × \(data.prReps)", x: margin + 32, y: y + 138,
                   size: 72, font: display, color: black, alpha: inner, align: .left)
          _ = text(ctx, prLift, x: rail - 32, y: y + 138, size: 30,
                   font: ui, color: black, alpha: inner, align: .right)
          _ = text(ctx, "+\(data.prWeight - data.prPrev) LB", x: rail - 32, y: y + 58,
                   size: 30, font: ui, color: black, alpha: inner, align: .right)
          ctx.restoreGState()
        }
      }
    }

    // lift list
    for (j, lift) in data.lifts.enumerated() {
      let lp = seg(t, 3.3 + Double(j) * 0.1, 3.95 + Double(j) * 0.1)
      if lp <= 0 { continue }
      let ly: CGFloat = 1140 + CGFloat(j) * 82
      ctx.saveGState()
      ctx.setAlpha(CGFloat(lp) * 0.9)
      ctx.setStrokeColor(CGColor(red: 0.137, green: 0.165, blue: 0.188, alpha: 1))
      ctx.setLineWidth(2)
      ctx.move(to: CGPoint(x: margin, y: ly + 26))
      ctx.addLine(to: CGPoint(x: rail, y: ly + 26))
      ctx.strokePath()
      ctx.restoreGState()

      let c = lift.isPR ? volt : CGColor(red: 0.91, green: 0.918, blue: 0.929, alpha: 1)
      _ = text(ctx, lift.name, x: margin + CGFloat(1 - outCubic(lp)) * 30, y: ly,
               size: 38, font: ui, color: c, alpha: lp, align: .left)
      _ = text(ctx, lift.load, x: rail, y: ly, size: 38,
               font: ui, color: c, alpha: lp, align: .right)
    }

    // watermark — the acquisition channel; keep it inside the safe box
    let wp = seg(t, 4.6, 5.3)
    if wp > 0 {
      _ = text(ctx, data.watermark, x: margin, y: safeBottom, size: 34,
               font: display, color: volt, alpha: wp * 0.92, align: .left)
    }
  }

  // MARK: - primitives

  private func drawBase(_ ctx: CGContext,
                        underlay: (image: CGImage, transform: CGAffineTransform, size: CGSize)?) {
    if let u = underlay {
      // cover-fit, honouring the clip's rotation transform
      let s = max(W / u.size.width, H / u.size.height)
      let dw = u.size.width * s, dh = u.size.height * s
      ctx.saveGState()
      ctx.translateBy(x: (W - dw) / 2, y: (H - dh) / 2)
      ctx.concatenate(u.transform)
      ctx.draw(u.image, in: CGRect(x: 0, y: 0, width: dw, height: dh))
      ctx.restoreGState()
      // scrim so burned-in type survives any footage
      drawVerticalGradient(ctx, stops: [
        (0.00, 0.86), (0.34, 0.30), (0.62, 0.55), (1.00, 0.95)
      ])
    } else {
      ctx.setFillColor(bg)
      ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
      if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                            colors: [CGColor(red: 0.8, green: 1, blue: 0, alpha: 0.13),
                                     CGColor(red: 0.8, green: 1, blue: 0, alpha: 0)] as CFArray,
                            locations: [0, 1]) {
        ctx.saveGState()
        ctx.drawRadialGradient(g, startCenter: CGPoint(x: 200, y: 260), startRadius: 0,
                               endCenter: CGPoint(x: 200, y: 260), endRadius: 1100,
                               options: [])
        ctx.restoreGState()
      }
    }
  }

  private func drawVerticalGradient(_ ctx: CGContext, stops: [(CGFloat, CGFloat)]) {
    let colors = stops.map {
      CGColor(red: 0.031, green: 0.035, blue: 0.039, alpha: $0.1)
    } as CFArray
    guard let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                             colors: colors,
                             locations: stops.map { $0.0 }) else { return }
    ctx.saveGState()
    ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: H), options: [])
    ctx.restoreGState()
  }

  private enum Align { case left, right }

  /// Draws text and returns its advance width. Letter-spacing is applied by
  /// advancing per glyph, matching the manual tracking in recap.js.
  @discardableResult
  private func text(_ ctx: CGContext, _ s: String, x: CGFloat, y: CGFloat, size: CGFloat,
                    font name: String, color: CGColor, alpha: Double,
                    align: Align = .left, track: CGFloat = 0) -> CGFloat {
    let font = CTFontCreateWithName(name as CFString, size, nil)
    let attrs: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: color, .kern: track
    ]
    let attr = NSAttributedString(string: s, attributes: attrs)
    let line = CTLineCreateWithAttributedString(attr)
    let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))

    ctx.saveGState()
    ctx.setAlpha(CGFloat(alpha))
    // undo the global flip so glyphs are not mirrored
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    ctx.textPosition = CGPoint(x: align == .left ? x : x - width, y: y)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
    return width
  }

  private func riseText(_ ctx: CGContext, _ s: String, x: CGFloat, y: CGFloat, size: CGFloat,
                        p: Double, font: String, color: CGColor, track: CGFloat) {
    if p <= 0 { return }
    ctx.saveGState()
    ctx.clip(to: CGRect(x: x - 40, y: y - size, width: W, height: size * 1.28))
    let dy = CGFloat(1 - outExpo(p)) * size * 1.1
    _ = text(ctx, s, x: x, y: y + dy, size: size, font: font,
             color: color, alpha: min(1, p * 1.6), align: .left, track: track)
    ctx.restoreGState()
  }

  private func commas(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    return f.string(from: NSNumber(value: n)) ?? "\(n)"
  }
}
