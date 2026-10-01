# audio_urls.json의 음성 14개를 내려받아 frames/ 자막 프레임과 합쳐 음성 포함 mp4를 만드는 로컬 실행 스크립트
# 사용(이 폴더에서): python add_voice.py     필요: python3, ffmpeg/ffprobe (다른 설치 불필요)
import json, math, os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, 'audio')
FRAMES = os.path.join(HERE, 'frames')
OUT = os.path.join(HERE, '원더_골든벨_사용법_음성.mp4')
TAIL = 1.2  # 음성이 끝난 뒤 장면을 유지하는 여유(초)

urls = json.load(open(os.path.join(HERE, 'audio_urls.json'), encoding='utf8'))
scenes = json.load(open(os.path.join(HERE, 'scenes', 'meta.json'), encoding='utf8'))['scenes']

# 무음 영상(compose.js)과 같은 기본 장면 길이: 인트로 6초, 마무리 12초, 단계는 자막 길이 기준
slot = {'00': 6, '99': 12}
for s in scenes:
    slot[s['id']] = max(6, math.ceil(len(s['caption']) / 6) + 2)

def run(cmd):
    subprocess.run(cmd, check=True)

def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       check=True, capture_output=True, text=True)
    return float(r.stdout.strip())

os.makedirs(AUDIO, exist_ok=True)
for key in sorted(urls):
    path = os.path.join(AUDIO, key + '.mp3')
    if not os.path.exists(path):
        print('내려받는 중', key)
        urllib.request.urlretrieve(urls[key], path)

order = ['00'] + [s['id'] for s in scenes] + ['99']
clips = []
for key in order:
    png = os.path.join(FRAMES, 'f' + key + '.png')
    mp3 = os.path.join(AUDIO, key + '.mp3')
    d = max(slot[key], duration(mp3) + TAIL)
    clip = os.path.join(AUDIO, 'clip_' + key + '.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', f'{d:.2f}', '-i', png, '-i', mp3,
         '-vf', f'fade=in:0:10,fade=out:st={d - 0.4:.2f}:d=0.4,format=yuv420p',
         '-af', 'apad', '-t', f'{d:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', clip])
    clips.append(clip)
    print(key, f'{d:.1f}초')

lst = os.path.join(AUDIO, 'list.txt')
with open(lst, 'w', encoding='utf8') as f:
    f.write('\n'.join("file '" + c.replace('\\', '/') + "'" for c in clips))
run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', OUT])
print('완료:', OUT, f'({duration(OUT):.0f}초)')
