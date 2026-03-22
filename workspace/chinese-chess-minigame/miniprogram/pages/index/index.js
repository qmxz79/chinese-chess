Page({
  data: {
    title: '中国象棋微信小游戏',
    subtitle: '先跑起来，再变强',
  },

  goGame() {
    wx.navigateTo({ url: '/pages/game/game' });
  },

  goTutorial() {
    wx.navigateTo({ url: '/pages/tutorial/tutorial' });
  },
});
