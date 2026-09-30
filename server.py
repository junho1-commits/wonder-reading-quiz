# -*- coding: utf-8 -*-
"""
소설 《원더》 실시간 독서 골든벨 서버 (Wonder Live Reading Goldenbell Server)
- 초등학교 교실 전자칠판 대화면 및 학생 스마트폰/크롬북 실시간 연동
- Python 표준 라이브러리 및 qrcode 모듈 기반 무설치 실행
"""

import os
import sys
import io
import json
import time
import socket
import threading
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, SimpleHTTPRequestHandler
import qrcode

# Windows 콘솔 인코딩 에러 방지
try:
    if sys.stdout:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_FILE = os.path.join(BASE_DIR, "questions.json")

# 문제 로드
with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

def get_local_ip():
    """교실 내부망 로컬 IP 자동 탐색"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

LOCAL_IP = get_local_ip()
SERVER_PORT = 8888

class GameEngine:
    def __init__(self):
        self.lock = threading.Lock()
        self.status = "lobby"  # lobby, question, answer, finished
        self.current_q_index = 0
        self.show_hint = False
        self.timer_total = 30
        self.timer_remaining = 30
        self.timer_active = False
        self.students = {}  # id -> {id, name, score, streak, last_seen, answers: {q_idx: choice}}
        self.current_answers = {}  # student_id -> choice (1~4)
        self.answer_times = {}  # student_id -> submit_elapsed_seconds
        self.start_question_time = 0

        # 백그라운드 타이머 스레드 시작
        self.timer_thread = threading.Thread(target=self._timer_loop, daemon=True)
        self.timer_thread.start()

    def _timer_loop(self):
        while True:
            time.sleep(1)
            with self.lock:
                if self.status == "question" and self.timer_active and self.timer_remaining > 0:
                    self.timer_remaining -= 1
                    if self.timer_remaining == 0:
                        # 시간 종료 시: 자동 공개하지 않고 시간 마감 상태로 대기 (교사가 직접 정답 공개 버튼 클릭)
                        self.timer_active = False

    def _reveal_answer_locked(self):
        self.status = "answer"
        self.timer_active = False
        correct_answer = QUESTIONS[self.current_q_index]["answer"]
        
        # 채점 및 점수 계산 (빠르게 맞힐수록 보너스 점수)
        for s_id, choice in self.current_answers.items():
            if s_id in self.students:
                s = self.students[s_id]
                is_correct = (choice == correct_answer)
                s["answers"][self.current_q_index] = {
                    "choice": choice,
                    "correct": is_correct
                }
                if is_correct:
                    elapsed = self.answer_times.get(s_id, 30.0)
                    time_bonus = max(0, int((30 - elapsed) * 2))  # 최대 60점 추가
                    base_score = 100
                    s["score"] += (base_score + time_bonus)
                    s["streak"] += 1
                else:
                    s["streak"] = 0

    def join_student(self, name):
        with self.lock:
            name = name.strip()
            if not name:
                name = "학생"
            # 중복 체크 방지 및 고유 ID 발급
            student_id = f"s_{int(time.time()*1000)}_{len(self.students)+1}"
            self.students[student_id] = {
                "id": student_id,
                "name": name,
                "score": 0,
                "streak": 0,
                "last_seen": time.time(),
                "answers": {}
            }
            return student_id

    def submit_answer(self, student_id, q_index, choice):
        with self.lock:
            if self.status != "question":
                return False, "현재 답안을 제출할 수 있는 상태가 아닙니다."
            if q_index != self.current_q_index:
                return False, "문제 번호가 일치하지 않습니다."
            if student_id not in self.students:
                return False, "등록되지 않은 학생입니다."

            self.current_answers[student_id] = choice
            elapsed = time.time() - self.start_question_time
            self.answer_times[student_id] = elapsed

            # 전원 제출하더라도 교사가 직접 [정답 공개] 버튼을 누를 때까지 대기
            return True, "제출 완료"

    def handle_teacher_action(self, action, payload=None):
        with self.lock:
            if action == "start":
                self.current_q_index = 0
                self.status = "question"
                self.show_hint = False
                self.timer_total = QUESTIONS[0].get("timeLimit", 30)
                self.timer_remaining = self.timer_total
                self.timer_active = True
                self.current_answers.clear()
                self.answer_times.clear()
                self.start_question_time = time.time()
                # 학생 점수 초기화
                for s in self.students.values():
                    s["score"] = 0
                    s["streak"] = 0
                    s["answers"].clear()

            elif action == "next":
                if self.current_q_index < len(QUESTIONS) - 1:
                    self.current_q_index += 1
                    self.status = "question"
                    self.show_hint = False
                    self.timer_total = QUESTIONS[self.current_q_index].get("timeLimit", 30)
                    self.timer_remaining = self.timer_total
                    self.timer_active = True
                    self.current_answers.clear()
                    self.answer_times.clear()
                    self.start_question_time = time.time()
                else:
                    self.status = "finished"
                    self.timer_active = False

            elif action == "prev":
                if self.current_q_index > 0:
                    self.current_q_index -= 1
                    self.status = "question"
                    self.show_hint = False
                    self.timer_total = QUESTIONS[self.current_q_index].get("timeLimit", 30)
                    self.timer_remaining = self.timer_total
                    self.timer_active = True
                    self.current_answers.clear()
                    self.answer_times.clear()
                    self.start_question_time = time.time()

            elif action == "reveal_hint":
                self.show_hint = True

            elif action == "reveal_answer":
                if self.status == "question":
                    self._reveal_answer_locked()

            elif action == "toggle_timer":
                self.timer_active = not self.timer_active

            elif action == "reset":
                self.status = "lobby"
                self.current_q_index = 0
                self.show_hint = False
                self.timer_active = False
                self.current_answers.clear()
                self.answer_times.clear()
                for s in self.students.values():
                    s["score"] = 0
                    s["streak"] = 0
                    s["answers"].clear()

            elif action == "clear_students":
                self.students.clear()
                self.current_answers.clear()
                self.answer_times.clear()

    def get_teacher_state(self):
        with self.lock:
            # 선택지별 제출 인원 통계
            choice_counts = {1: 0, 2: 0, 3: 0, 4: 0}
            for choice in self.current_answers.values():
                if choice in choice_counts:
                    choice_counts[choice] += 1

            # 학생 리스트 및 랭킹 정렬
            student_list = list(self.students.values())
            student_list.sort(key=lambda x: x["score"], reverse=True)

            q_data = None
            if self.current_q_index < len(QUESTIONS):
                q = QUESTIONS[self.current_q_index]
                q_data = {
                    "id": q["id"],
                    "stage": q["stage"],
                    "question": q["question"],
                    "options": q["options"],
                    "answer": q["answer"] if self.status in ["answer", "finished"] else None,
                    "hint": q["hint"],
                    "explanation": q["explanation"] if self.status in ["answer", "finished"] else None,
                    "totalQuestions": len(QUESTIONS)
                }

            return {
                "status": self.status,
                "currentQuestionIndex": self.current_q_index,
                "question": q_data,
                "showHint": self.show_hint,
                "timerTotal": self.timer_total,
                "timerRemaining": self.timer_remaining,
                "timerActive": self.timer_active,
                "totalStudents": len(self.students),
                "submittedCount": len(self.current_answers),
                "choiceCounts": choice_counts,
                "students": student_list,
                "localIp": LOCAL_IP,
                "serverPort": SERVER_PORT
            }

    def get_student_state(self, student_id):
        with self.lock:
            if student_id not in self.students:
                return {"valid": False}

            student = self.students[student_id]
            student["last_seen"] = time.time()

            q_data = None
            my_choice = self.current_answers.get(student_id, None)
            correct_answer = None

            if self.status in ["question", "answer"]:
                q = QUESTIONS[self.current_q_index]
                if self.status == "answer":
                    correct_answer = q["answer"]

                q_data = {
                    "id": q["id"],
                    "stage": q["stage"],
                    "question": q["question"],
                    "options": q["options"],
                    "timeLimit": self.timer_total
                }

            # 현재 나의 순위 계산
            all_scores = sorted([s["score"] for s in self.students.values()], reverse=True)
            my_rank = (all_scores.index(student["score"]) + 1) if student["score"] in all_scores else 1

            return {
                "valid": True,
                "status": self.status,
                "studentName": student["name"],
                "score": student["score"],
                "streak": student["streak"],
                "rank": my_rank,
                "totalStudents": len(self.students),
                "currentQuestionIndex": self.current_q_index,
                "question": q_data,
                "myChoice": my_choice,
                "correctAnswer": correct_answer,
                "timerRemaining": self.timer_remaining
            }

game = GameEngine()

class GoldenBellHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 교실 환경 캐싱 방지 및 CORS 허용
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ["/", "/teacher"]:
            self.serve_file(os.path.join(BASE_DIR, "teacher.html"), "text/html; charset=utf-8")
        elif path == "/student":
            self.serve_file(os.path.join(BASE_DIR, "student.html"), "text/html; charset=utf-8")
        elif path == "/api/qr.png":
            # 학생 접속용 QR코드 이미지 즉시 생성
            student_url = f"http://{LOCAL_IP}:{SERVER_PORT}/student"
            img = qrcode.make(student_url)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            img_bytes = buf.getvalue()

            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(img_bytes)))
            self.end_headers()
            self.wfile.write(img_bytes)
        elif path == "/api/teacher/state":
            state = game.get_teacher_state()
            self.send_json(state)
        elif path == "/api/student/state":
            student_id = query.get("id", [""])[0]
            state = game.get_student_state(student_id)
            self.send_json(state)
        else:
            # 기타 정적 파일 서빙
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if path == "/api/student/join":
            name = data.get("name", "학생")
            s_id = game.join_student(name)
            self.send_json({"success": True, "studentId": s_id})

        elif path == "/api/student/submit":
            s_id = data.get("studentId")
            q_idx = data.get("questionIndex")
            choice = data.get("choice")
            success, msg = game.submit_answer(s_id, q_idx, choice)
            self.send_json({"success": success, "message": msg})

        elif path == "/api/teacher/action":
            action = data.get("action")
            game.handle_teacher_action(action, data)
            self.send_json({"success": True})

        else:
            self.send_response(404)
            self.end_headers()

    def send_json(self, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def serve_file(self, filepath, content_type):
        if not os.path.exists(filepath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"File not found")
            return
        with open(filepath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

def run_server():
    global SERVER_PORT
    import webbrowser
    # 빈 포트 자동 탐색 (8888 ~ 8900)
    for port in range(8888, 8910):
        try:
            server = HTTPServer(("0.0.0.0", port), GoldenBellHandler)
            SERVER_PORT = port
            break
        except OSError:
            continue

    print("=" * 60)
    print(" [원더 (Wonder) 실시간 독서 골든벨 서버 실행 중]")
    print(f" [교사용 전자칠판 주소] : http://localhost:{SERVER_PORT}")
    print(f" [학생 스마트폰/크롬북] : http://{LOCAL_IP}:{SERVER_PORT}/student")
    print("=" * 60)

    # 1.2초 후 브라우저 자동 실행
    threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{SERVER_PORT}")).start()

    server.serve_forever()

if __name__ == "__main__":
    run_server()
