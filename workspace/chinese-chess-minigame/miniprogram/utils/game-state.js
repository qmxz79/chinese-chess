function createGameState() {
  return {
    mode: 'ai',
    side: 'red',
    status: 'ready',
    winner: null,
    moveCount: 0,
    message: '准备开始',
  };
}

module.exports = { createGameState };
