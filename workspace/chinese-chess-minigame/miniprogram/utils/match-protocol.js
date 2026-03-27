const { Side, oppositeSide } = require('./chess-engine');

const PROTOCOL_VERSION = '1.0';

const MatchMode = Object.freeze({
  LOCAL: 'local',
  ONLINE: 'online',
});

const MatchState = Object.freeze({
  IDLE: 'idle',
  MATCHING: 'matching',
  READY: 'ready',
  PLAYING: 'playing',
  WAITING: 'waiting',
  SYNCHRONIZING: 'synchronizing',
  FINISHED: 'finished',
  ERROR: 'error',
});

const MatchEventType = Object.freeze({
  REQUEST: 'match.request',
  ACCEPT: 'match.accept',
  REJECT: 'match.reject',
  MOVE: 'match.move',
  ACK: 'match.ack',
  SYNC: 'match.sync',
  HEARTBEAT: 'match.heartbeat',
  RESIGN: 'match.resign',
  DRAW_OFFER: 'match.draw.offer',
  DRAW_RESPONSE: 'match.draw.response',
  ERROR: 'match.error',
});

function createMatchRoom({
  roomId = null,
  selfId = null,
  selfSide = Side.RED,
  mode = MatchMode.ONLINE,
  state = MatchState.IDLE,
  turn = Side.RED,
  sequence = 0,
  seed = null,
} = {}) {
  return {
    roomId,
    selfId,
    selfSide,
    mode,
    state,
    turn,
    sequence,
    seed,
    opponentId: null,
    opponentSide: selfSide === Side.RED ? Side.BLACK : Side.RED,
    lastAckSeq: 0,
    lastHeartbeatAt: null,
    lastEventAt: null,
    lastError: null,
    result: null,
    pendingDraw: false,
    snapshot: null,
    moveLog: [],
  };
}

function createEnvelope(type, payload = {}, meta = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    roomId: meta.roomId || null,
    senderId: meta.senderId || null,
    seq: meta.seq || 0,
    ts: meta.ts || Date.now(),
    payload,
  };
}

function createMatchRequest({ roomId = null, senderId, desiredSide = null, seed = null } = {}) {
  return createEnvelope(MatchEventType.REQUEST, { desiredSide, seed }, { roomId, senderId });
}

function createMatchAccept({ roomId, senderId, opponentId, selfSide, seed = null } = {}) {
  return createEnvelope(MatchEventType.ACCEPT, { opponentId, selfSide, seed }, { roomId, senderId });
}

function createMoveEvent({ roomId, senderId, move, seq = 0 } = {}) {
  return createEnvelope(MatchEventType.MOVE, { move }, { roomId, senderId, seq });
}

function createAckEvent({ roomId, senderId, ackSeq = 0, hash = null } = {}) {
  return createEnvelope(MatchEventType.ACK, { ackSeq, hash }, { roomId, senderId });
}

function createSyncEvent({ roomId, senderId, board, turn, moveSeq = 0 } = {}) {
  return createEnvelope(MatchEventType.SYNC, { board, turn, moveSeq }, { roomId, senderId });
}

function createHeartbeatEvent({ roomId, senderId, ping = Date.now() } = {}) {
  return createEnvelope(MatchEventType.HEARTBEAT, { ping }, { roomId, senderId });
}

function createResignEvent({ roomId, senderId } = {}) {
  return createEnvelope(MatchEventType.RESIGN, {}, { roomId, senderId });
}

function createDrawOfferEvent({ roomId, senderId } = {}) {
  return createEnvelope(MatchEventType.DRAW_OFFER, {}, { roomId, senderId });
}

function createDrawResponseEvent({ roomId, senderId, accepted = false } = {}) {
  return createEnvelope(MatchEventType.DRAW_RESPONSE, { accepted }, { roomId, senderId });
}

function createErrorEvent({ roomId, senderId, code = 'UNKNOWN', message = 'unknown error' } = {}) {
  return createEnvelope(MatchEventType.ERROR, { code, message }, { roomId, senderId });
}

function isProtocolEnvelope(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.v === PROTOCOL_VERSION &&
    typeof value.type === 'string' &&
    value.payload &&
    typeof value.payload === 'object'
  );
}

function canSendMove(room) {
  return room.state === MatchState.PLAYING && room.turn === room.selfSide && !room.lastError;
}

function applyMatchEvent(room, envelope) {
  if (!isProtocolEnvelope(envelope)) {
    return {
      ...room,
      state: MatchState.ERROR,
      lastError: { code: 'INVALID_ENVELOPE', message: 'not a valid protocol envelope' },
      lastEventAt: Date.now(),
    };
  }

  const next = {
    ...room,
    lastEventAt: envelope.ts || Date.now(),
  };

  switch (envelope.type) {
    case MatchEventType.REQUEST:
      next.state = MatchState.MATCHING;
      next.roomId = envelope.roomId || room.roomId;
      next.seed = envelope.payload.seed ?? room.seed;
      break;
    case MatchEventType.ACCEPT: {
      const assignedSelfSide = envelope.payload.selfSide || room.selfSide;
      next.state = MatchState.PLAYING;
      next.roomId = envelope.roomId || room.roomId;
      next.opponentId = envelope.payload.opponentId || room.opponentId;
      next.selfSide = assignedSelfSide;
      next.opponentSide = oppositeSide(assignedSelfSide);
      next.turn = Side.RED;
      next.seed = envelope.payload.seed ?? room.seed;
      next.result = null;
      break;
    }
    case MatchEventType.REJECT:
      next.state = MatchState.IDLE;
      next.lastError = { code: 'MATCH_REJECTED', message: envelope.payload.reason || 'rejected' };
      break;
    case MatchEventType.SYNC:
      next.state = MatchState.SYNCHRONIZING;
      next.snapshot = envelope.payload.board || null;
      next.turn = envelope.payload.turn || next.turn;
      next.sequence = envelope.payload.moveSeq ?? next.sequence;
      break;
    case MatchEventType.MOVE:
      next.sequence = Math.max(next.sequence, envelope.seq || 0) + 1;
      next.turn = oppositeSide(room.turn);
      next.moveLog = [...room.moveLog, envelope.payload.move];
      next.state = MatchState.PLAYING;
      break;
    case MatchEventType.ACK:
      next.lastAckSeq = Math.max(room.lastAckSeq, envelope.payload.ackSeq || 0);
      break;
    case MatchEventType.HEARTBEAT:
      next.lastHeartbeatAt = envelope.ts || Date.now();
      break;
    case MatchEventType.RESIGN:
      next.state = MatchState.FINISHED;
      next.result = {
        winner: envelope.senderId && envelope.senderId === room.selfId ? room.opponentSide : room.selfSide,
        reason: 'resign',
      };
      break;
    case MatchEventType.DRAW_OFFER:
      next.pendingDraw = true;
      break;
    case MatchEventType.DRAW_RESPONSE:
      next.pendingDraw = false;
      if (envelope.payload.accepted) {
        next.state = MatchState.FINISHED;
        next.result = { winner: null, reason: 'draw' };
      }
      break;
    case MatchEventType.ERROR:
      next.state = MatchState.ERROR;
      next.lastError = {
        code: envelope.payload.code || 'UNKNOWN',
        message: envelope.payload.message || 'unknown error',
      };
      break;
    default:
      next.lastError = { code: 'UNSUPPORTED_EVENT', message: envelope.type };
      next.state = MatchState.ERROR;
      break;
  }

  return next;
}

function describeMatchRoom(room) {
  return {
    roomId: room.roomId,
    state: room.state,
    turn: room.turn,
    selfSide: room.selfSide,
    opponentSide: room.opponentSide,
    sequence: room.sequence,
    lastAckSeq: room.lastAckSeq,
    pendingDraw: room.pendingDraw,
    hasSnapshot: Boolean(room.snapshot),
    result: room.result,
    error: room.lastError,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  MatchMode,
  MatchState,
  MatchEventType,
  createMatchRoom,
  createEnvelope,
  createMatchRequest,
  createMatchAccept,
  createMoveEvent,
  createAckEvent,
  createSyncEvent,
  createHeartbeatEvent,
  createResignEvent,
  createDrawOfferEvent,
  createDrawResponseEvent,
  createErrorEvent,
  isProtocolEnvelope,
  canSendMove,
  applyMatchEvent,
  describeMatchRoom,
};
