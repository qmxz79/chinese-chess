const { createMatchRoom, MatchMode, MatchState } = require('./match-protocol');

const MATCH_STORAGE_KEY = 'chess:lastMatch';
const MATCH_ROOM_KEY = 'chess:matchRoom';
const SIGNAL_URL_KEY = 'chess:signalUrl';

function saveLastMatch(match) {
  wx.setStorageSync(MATCH_STORAGE_KEY, match);
}

function loadLastMatch() {
  try {
    return wx.getStorageSync(MATCH_STORAGE_KEY) || null;
  } catch (error) {
    return null;
  }
}

function clearLastMatch() {
  try {
    wx.removeStorageSync(MATCH_STORAGE_KEY);
  } catch (error) {
    // noop
  }
}

function saveMatchRoom(room) {
  try {
    wx.setStorageSync(MATCH_ROOM_KEY, room);
  } catch (error) {
    // noop
  }
}

function loadMatchRoom() {
  try {
    return wx.getStorageSync(MATCH_ROOM_KEY) || createMatchRoom({ mode: MatchMode.ONLINE, state: MatchState.IDLE });
  } catch (error) {
    return createMatchRoom({ mode: MatchMode.ONLINE, state: MatchState.IDLE });
  }
}

function clearMatchRoom() {
  try {
    wx.removeStorageSync(MATCH_ROOM_KEY);
  } catch (error) {
    // noop
  }
}

function saveSignalUrl(signalUrl) {
  try {
    wx.setStorageSync(SIGNAL_URL_KEY, signalUrl || '');
  } catch (error) {
    // noop
  }
}

function loadSignalUrl() {
  try {
    return wx.getStorageSync(SIGNAL_URL_KEY) || '';
  } catch (error) {
    return '';
  }
}

module.exports = {
  saveLastMatch,
  loadLastMatch,
  clearLastMatch,
  saveMatchRoom,
  loadMatchRoom,
  clearMatchRoom,
  saveSignalUrl,
  loadSignalUrl,
};

