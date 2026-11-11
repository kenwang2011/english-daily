#!/bin/bash
# 重新生成全部预录音频：中文句子（audio/zh/，晓晓）、
# 整词拼读（audio/spell/）和英文单词、例句（audio/en/），英文都是 Michelle。
# 加了新词，或改了词库的中文、data/guide.js、data/tips.js、app.js 里的中文句式之后要重跑，
# 否则改过的句子找不到录音，会退回系统 TTS。只合成缺的，已有的跳过。
# 依赖：node、ffmpeg、python3（会在 tools/.venv 里装 edge-tts 和 numpy），需要联网。
# 嗓音来自微软，走的是 Edge 浏览器朗读功能的接口，不需要账号或 key。
set -e
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q edge-tts numpy; }
WORK=$(mktemp -d)
node zh-lines.js > "$WORK/lines.json"
"${PY:-.venv/bin/python}" zh_synth.py "$WORK/lines.json" "$(cd .. && pwd)"
node zh-lines.js allSpellLines > "$WORK/spell.json"
KIND=spell "${PY:-.venv/bin/python}" zh_synth.py "$WORK/spell.json" "$(cd .. && pwd)"
node zh-lines.js allEnLines > "$WORK/en.json"
KIND=en "${PY:-.venv/bin/python}" zh_synth.py "$WORK/en.json" "$(cd .. && pwd)"
rm -rf "$WORK"
