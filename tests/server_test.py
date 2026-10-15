"""QR 이미지 생성과 네트워크를 사용하지 않는 서버 채점 회귀 검사."""
import ast
import json
import pathlib
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
source = ast.parse((ROOT / "server.py").read_text(encoding="utf-8"))
names = {"normalize_answer", "matches_answer_groups", "is_correct_answer", "GameEngine"}
# 서버 구동과 외부 QR 모듈 없이 실제 채점 함수/클래스를 가져옵니다.
body = [n for n in source.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
module = types.ModuleType("quiz_server_under_test")
import threading
import time
import unicodedata
module.__dict__.update(threading=threading, time=time, unicodedata=unicodedata,
                       LOCAL_IP="127.0.0.1", SERVER_PORT=8888,
                       QUESTIONS=json.loads((ROOT / "questions.json").read_text(encoding="utf-8")))
exec(compile(ast.Module(body=body, type_ignores=[]), "server.py", "exec"), module.__dict__)

class GradingTests(unittest.TestCase):
    def test_all_answers_and_spacing(self):
        for q in module.QUESTIONS:
            with self.subTest(question=q["id"]):
                self.assertTrue(module.is_correct_answer(q, q["answer"]))
                self.assertFalse(module.is_correct_answer(q, None))
                self.assertFalse(module.is_correct_answer(q, ""))
                if q["type"] == "short":
                    self.assertTrue(module.is_correct_answer(q, q["answer"].replace(" ", "")))
                    for alias in q["acceptedAnswers"]:
                        self.assertTrue(module.is_correct_answer(q, alias))

    def test_multiple_blanks(self):
        q = module.QUESTIONS
        self.assertTrue(module.is_correct_answer(q[17], "샬럿과 잭 윌 그리고 줄리안"))
        self.assertFalse(module.is_correct_answer(q[17], "샬롯, 잭 윌"))
        self.assertFalse(module.is_correct_answer(q[15], "코딱지, 눈곱"))
        self.assertFalse(module.is_correct_answer(q[26], "펭귄, 코뿔소"))

    def test_submission_and_reveal(self):
        game = module.GameEngine()
        sid = game.join_student("테스트")
        game.handle_teacher_action("start")
        self.assertFalse(game.submit_answer(sid, 0, " \t\n")[0])
        self.assertFalse(game.submit_answer(sid, 1, "흰바위코뿔소")[0])
        self.assertTrue(game.submit_answer(sid, 0, "흰 바위코 뿔소")[0])
        self.assertFalse(game.submit_answer(sid, 0, "다른 답")[0])
        self.assertIsNone(game.get_teacher_state()["question"]["answer"])
        self.assertEqual(game.get_teacher_state()["question"]["acceptedAnswers"], [])
        game.handle_teacher_action("reveal_answer")
        self.assertTrue(game.get_student_state(sid)["isCorrect"])

if __name__ == "__main__":
    unittest.main()
