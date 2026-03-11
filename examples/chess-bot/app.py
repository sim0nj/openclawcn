from flask import Flask, request, jsonify
import chess
import chess.engine
import random

app = Flask(__name__)

# 如果你有 Stockfish 引擎，可以取消注释并修改路径
# engine = chess.engine.SimpleEngine.popen_uci("/usr/bin/stockfish")

@app.route('/metadata', methods=['GET'])
def metadata():
    return jsonify({
        'agentName': 'Example Chess Bot',
        'model': 'random-policy',
        'vendor': 'example',
        'version': 'v1',
        'capabilities': ['move', 'metadata']
    })

@app.route('/move', methods=['POST'])
def get_move():
    data = request.json
    fen = data.get('fen')
    
    if not fen:
        return jsonify({'error': 'No FEN provided'}), 400
        
    board = chess.Board(fen)
    
    # 策略 1: 使用 Stockfish (如果配置了)
    # result = engine.play(board, chess.engine.Limit(time=0.1))
    # move = result.move
    
    # 策略 2: 随机合法移动 (默认)
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return jsonify({'error': 'No legal moves'}), 400
        
    move = random.choice(legal_moves)
    
    # 返回 SAN 格式 (Standard Algebraic Notation) e.g., "e4", "Nf3"
    san_move = board.san(move)
    
    return jsonify({
        'move': san_move,
        'uci': move.uci() # 可选
    })

if __name__ == '__main__':
    print("OpenClaw Chess Skill running on port 5000")
    app.run(host='0.0.0.0', port=5000)
