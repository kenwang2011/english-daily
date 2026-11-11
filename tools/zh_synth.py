"""把 lines.json（{指纹: 文本}）合成为 audio/<KIND>/<指纹>.mp3，并写出清单 js（指纹 → 毫秒）。
KIND=zh（默认，晓晓读中文）、spell（Michelle 读拼读）或 en（Michelle 读单词和例句）。
已存在的文件会跳过，所以中途断了可以直接重跑。"""
import asyncio, json, os, subprocess, sys
import edge_tts

lines_path, root = sys.argv[1], sys.argv[2]
KIND = os.environ.get('KIND', 'zh')
CFG = {'zh': ('zh-CN-XiaoxiaoNeural', 'zh-audio.js', 'ZH_AUDIO', '中文预录音频'),
       'spell': ('en-US-MichelleNeural', 'spell-audio.js', 'SPELL_AUDIO', '整词拼读预录音频'),
       'en': ('en-US-MichelleNeural', 'en-audio.js', 'EN_AUDIO', '英文单词和例句预录音频')}[KIND]
VOICE = os.environ.get('VOICE', CFG[0])
out_dir = os.path.join(root, 'audio', KIND)
raw_dir = os.path.join(os.path.dirname(lines_path), KIND + '_raw')
os.makedirs(out_dir, exist_ok=True); os.makedirs(raw_dir, exist_ok=True)
lines = json.load(open(lines_path, encoding='utf-8'))
# 值可以是文本，也可以是 {t: 文本, r: 语速, v: 换用的嗓音}（英文单词分常速 / 慢速两版）
SPEED = {k: v['r'] for k, v in lines.items() if isinstance(v, dict)}
ALT_VOICE = {k: v['v'] for k, v in lines.items() if isinstance(v, dict) and v.get('v')}
lines = {k: (v['t'] if isinstance(v, dict) else v) for k, v in lines.items()}
import numpy as np

def trim_bounds(raw):
    """找出有声部分的起止秒数。只切掉真正的静音，并在两头各留一小段，
    避免把 v / f / s / h 这类很轻的辅音开头削掉（削掉后 V 听起来像 D）。"""
    pcm = np.frombuffer(subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', raw, '-f', 'f32le', '-ac', '1',
                                        '-ar', '16000', '-'], capture_output=True).stdout, dtype=np.float32)
    n = len(pcm) // 160
    if n < 3: return 0.0, len(pcm) / 16000
    rms = np.sqrt((pcm[:n * 160].reshape(n, 160) ** 2).mean(axis=1))
    loud = np.nonzero(rms > 0.002)[0]          # 约 -54dB，按 10ms 一帧
    if not len(loud): return 0.0, len(pcm) / 16000
    return max(0.0, loud[0] * 0.01 - 0.06), min(len(pcm) / 16000, (loud[-1] + 1) * 0.01 + 0.10)

# 个别拼读按默认写法合成后，语音识别会听错其中一个字母（B→D、P→T、E→D、单独的 A 被吞）。
# 逐个试出来的修正：放慢一点，或挪一下停顿的位置。键是默认的送读文本。
RATE = {
    'H, E, R.': '-8%',
    'F, O, O, T, B, A, L, L; P, L, A, Y, E, R.': '-22%',
}
TEXT = {
    'A, P, R, I, L.': 'A, P; R, I, L.',
    'S, E, E; A; D, O, C, T, O, R.': 'S, E, E; A, D, O, C, T, O, R.',
}

async def one(key, text, sem):
    dst = os.path.join(out_dir, key + '.mp3')
    if os.path.exists(dst) and os.path.getsize(dst) > 500: return True
    raw = os.path.join(raw_dir, key + '.mp3')
    async with sem:
        for attempt in range(4):
            try:
                if not (os.path.exists(raw) and os.path.getsize(raw) > 500):
                    await edge_tts.Communicate(TEXT.get(text, text), ALT_VOICE.get(key, VOICE), rate=SPEED.get(key) or RATE.get(text, '+0%')).save(raw)
                if os.path.getsize(raw) > 500: break
            except Exception as e:
                err = e
                await asyncio.sleep(1.5 * (attempt + 1))
        else:
            print('FAILED', key, text, err, flush=True); return False
    t0, t1 = trim_bounds(raw)
    # 只裁剪、不重新编码：再压一遍会损伤 b / p / d 这类辅音，拼读里差一点就听成别的字母
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', '%.3f' % t0, '-to', '%.3f' % t1, '-i', raw,
                    '-c', 'copy', dst], check=True)
    return True

async def main():
    sem = asyncio.Semaphore(4)
    res = await asyncio.gather(*[one(k, t, sem) for k, t in lines.items()])
    print('ok', sum(res), 'failed', len(res) - sum(res), flush=True)
    # 清掉不再用到的旧音频
    for f in os.listdir(out_dir):
        if f.endswith('.mp3') and f[:-4] not in lines: os.remove(os.path.join(out_dir, f))
    man = {}
    for k in sorted(lines):
        f = os.path.join(out_dir, k + '.mp3')
        if not os.path.exists(f): continue
        d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
                           capture_output=True, text=True).stdout.strip()
        man[k] = round(float(d) * 1000)
    with open(os.path.join(root, 'data', CFG[1]), 'w', encoding='utf-8') as fh:
        fh.write('/* ' + CFG[3] + '清单：指纹 → 时长（毫秒）。由 tools/make-zh-audio.sh 生成，不要手改。 */\n')
        fh.write('window.' + CFG[2] + ' = ' + json.dumps(man, separators=(',', ':')) + ';\n')
    print('manifest', len(man), flush=True)

asyncio.run(main())
