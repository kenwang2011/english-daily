#!/bin/bash
# 重新生成 data/letters.js（26 个字母名 + 英式 zed 的预录音频）。只在想换嗓音/语速时才需要跑。
# 依赖：macOS 自带的 swiftc、Samantha 语音，以及 ffmpeg。
# 读音用国际音标直接指定，不让 TTS 引擎去猜「a」「ay」该怎么念。
# 双元音必须带连音符（e͡ɪ / a͡ɪ / o͡ʊ），否则引擎会拆成两个元音来读。
set -e
cd "$(dirname "$0")"
OUT=$(mktemp -d)
VOICE=${VOICE:-com.apple.voice.compact.en-US.Samantha}
swiftc -O synth.swift -o "$OUT/synth" 2>/dev/null
"$OUT/synth" "$VOICE" "$OUT" \
  "a|a|e͡ɪ" "b|b|biː" "c|c|siː" "d|d|diː" "e|e|iː" "f|f|ɛf" "g|g|dʒiː" "h|h|e͡ɪtʃ" \
  "i|i|a͡ɪ" "j|j|dʒe͡ɪ" "k|k|ke͡ɪ" "l|l|ɛl" "m|m|ɛm" "n|n|ɛn" "o|o|o͡ʊ" "p|p|piː" \
  "q|q|kjuː" "r|r|ɑɹ" "s|s|ɛs" "t|t|tiː" "u|u|juː" "v|v|viː" "w|double you" "x|x|ɛks" \
  "y|y|wa͡ɪ" "z|z|ziː" "zed|z|zɛd" >/dev/null
{
  echo "/* 字母名预录音频（Samantha，按音标合成）。由 tools/make-letters.sh 生成，不要手改。"
  echo "   用预录音而不是 TTS 读字母：各家引擎对孤立字母的读法不一致（a 读成「呃」、ay 读成 eye），"
  echo "   预录音在 Mac / iPhone / 安卓上听到的完全一样。 */"
  echo "window.LETTER_AUDIO = {"
  for n in a b c d e f g h i j k l m n o p q r s t u v w x y z zed; do
    ffmpeg -loglevel error -y -i "$OUT/$n.caf" -ac 1 -ar 22050 -b:a 48k "$OUT/$n.mp3"
    echo "  $n: 'data:audio/mpeg;base64,$(base64 -i "$OUT/$n.mp3" | tr -d '\n')',"
  done
  echo "};"
} > ../data/letters.js
rm -rf "$OUT"
echo "已生成 data/letters.js"
