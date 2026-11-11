import AVFoundation
// usage: synth <voiceId> <outdir> name|text|ipa ...   (ipa optional)
let args = CommandLine.arguments
let voice = AVSpeechSynthesisVoice(identifier: args[1])
if voice == nil { print("voice not found"); exit(1) }
let outdir = args[2]
let synth = AVSpeechSynthesizer()
var items = Array(args.dropFirst(3))
func next() {
  if items.isEmpty { exit(0) }
  let parts = items.removeFirst().components(separatedBy: "|")
  let name = parts[0], text = parts[1]
  let ipa = parts.count > 2 ? parts[2] : ""
  let u: AVSpeechUtterance
  if !ipa.isEmpty {
    let a = NSMutableAttributedString(string: text)
    a.setAttributes([NSAttributedString.Key(rawValue: AVSpeechSynthesisIPANotationAttribute): ipa], range: NSRange(location: 0, length: a.length))
    u = AVSpeechUtterance(attributedString: a)
  } else { u = AVSpeechUtterance(string: text) }
  u.voice = voice
  u.rate = Float(ProcessInfo.processInfo.environment["RATE"] ?? "0.42")!
  var file: AVAudioFile? = nil
  var done = false
  synth.write(u) { buf in
    guard let pcm = buf as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { if done { return }; done = true; file = nil; print("ok \(name)"); DispatchQueue.main.async { next() }; return }
    if file == nil {
      file = try! AVAudioFile(forWriting: URL(fileURLWithPath: "\(outdir)/\(name).caf"), settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
    }
    try! file!.write(from: pcm)
  }
}
DispatchQueue.main.async { next() }
RunLoop.main.run()
