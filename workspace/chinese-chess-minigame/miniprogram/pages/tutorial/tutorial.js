const { createMatchRoom, MatchMode, MatchState, MatchEventType, createMatchRequest, createMatchAccept, createMoveEvent, createAckEvent, createSyncEvent, createHeartbeatEvent, createResignEvent, createDrawOfferEvent, createDrawResponseEvent, createErrorEvent, isProtocolEnvelope, applyMatchEvent, canSendMove } = require('../../utils/match-protocol');

Page({
  data: {
    protocolVersion: '1.0',
    eventTypes: Object.values(MatchEventType),
    room: createMatchRoom({ roomId: 'room-demo-001', selfId: 'local-red', selfSide: 'red', mode: MatchMode.ONLINE, state: MatchState.IDLE }),
    sampleEvent: null,
    sampleRoom: null,
    sampleSummary: null,
  },

  onLoad() {
    this.refreshSamples();
  },

  refreshSamples() {
    const request = createMatchRequest({ roomId: this.data.room.roomId, senderId: 'local-red', desiredSide: 'red', seed: 7 });
    const accepted = createMatchAccept({ roomId: this.data.room.roomId, senderId: 'remote-black', opponentId: 'remote-black', selfSide: 'red', seed: 7 });
    const moved = createMoveEvent({ roomId: this.data.room.roomId, senderId: 'local-red', move: { pieceId: 'r-r1', from: { x: 0, y: 9 }, to: { x: 0, y: 8 } }, seq: 1 });
    const sampleRoom = applyMatchEvent(applyMatchEvent(applyMatchEvent(this.data.room, request), accepted), moved);
    this.setData({
      sampleEvent: request,
      sampleRoom,
      sampleSummary: {
        valid: isProtocolEnvelope(request),
        canSendMove: canSendMove(sampleRoom),
        state: sampleRoom.state,
        turn: sampleRoom.turn,
      },
    });
  },

  injectRequest() {
    const next = applyMatchEvent(this.data.room, createMatchRequest({ roomId: 'room-demo-001', senderId: 'local-red', desiredSide: 'red' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  injectAccept() {
    const next = applyMatchEvent(this.data.room, createMatchAccept({ roomId: 'room-demo-001', senderId: 'remote-black', opponentId: 'remote-black', selfSide: 'red' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  injectSync() {
    const next = applyMatchEvent(this.data.room, createSyncEvent({ roomId: 'room-demo-001', senderId: 'remote-black', board: { demo: true }, turn: 'red', moveSeq: 2 }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  injectAck() {
    const next = applyMatchEvent(this.data.room, createAckEvent({ roomId: 'room-demo-001', senderId: 'remote-black', ackSeq: 2 }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  injectHeartbeat() {
    const next = applyMatchEvent(this.data.room, createHeartbeatEvent({ roomId: 'room-demo-001', senderId: 'remote-black' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  injectDraw() {
    const next = applyMatchEvent(this.data.room, createDrawOfferEvent({ roomId: 'room-demo-001', senderId: 'remote-black' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  acceptDraw() {
    const next = applyMatchEvent(this.data.room, createDrawResponseEvent({ roomId: 'room-demo-001', senderId: 'local-red', accepted: true }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  resign() {
    const next = applyMatchEvent(this.data.room, createResignEvent({ roomId: 'room-demo-001', senderId: 'remote-black' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  raiseError() {
    const next = applyMatchEvent(this.data.room, createErrorEvent({ roomId: 'room-demo-001', senderId: 'remote-black', code: 'NETWORK_ERROR', message: 'demo error' }));
    this.setData({ room: next });
    this.refreshSamples();
  },

  resetRoom() {
    this.setData({ room: createMatchRoom({ roomId: 'room-demo-001', selfId: 'local-red', selfSide: 'red', mode: MatchMode.ONLINE, state: MatchState.IDLE }) });
    this.refreshSamples();
  },
});
