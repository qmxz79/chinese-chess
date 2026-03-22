import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MatchEventType,
  MatchMode,
  MatchState,
  Side,
  applyMatchEvent,
  canSendMove,
  createAckEvent,
  createDrawOfferEvent,
  createMatchAccept,
  createMatchRequest,
  createMatchRoom,
  createMoveEvent,
  createResignEvent,
  createSyncEvent,
  describeMatchRoom,
  isProtocolEnvelope,
} from '../src/index.js';

test('match protocol creates a valid request envelope', () => {
  const envelope = createMatchRequest({ roomId: 'room-1', senderId: 'u-red', desiredSide: Side.RED, seed: 42 });
  assert.equal(isProtocolEnvelope(envelope), true);
  assert.equal(envelope.type, MatchEventType.REQUEST);
  assert.equal(envelope.payload.desiredSide, Side.RED);
});

test('match protocol transitions request -> accept -> move', () => {
  const room = createMatchRoom({ roomId: 'room-1', selfId: 'u-red', selfSide: Side.RED, mode: MatchMode.ONLINE });
  const requested = applyMatchEvent(room, createMatchRequest({ roomId: 'room-1', senderId: 'u-red', desiredSide: Side.RED }));
  assert.equal(requested.state, MatchState.MATCHING);

  const playing = applyMatchEvent(requested, createMatchAccept({ roomId: 'room-1', senderId: 'u-black', opponentId: 'u-black', selfSide: Side.RED }));
  assert.equal(playing.state, MatchState.PLAYING);
  assert.equal(canSendMove(playing), true);

  const moved = applyMatchEvent(playing, createMoveEvent({ roomId: 'room-1', senderId: 'u-red', move: { pieceId: 'r-r1', from: { x: 0, y: 9 }, to: { x: 0, y: 8 } }, seq: 1 }));
  assert.equal(moved.sequence, 2);
  assert.equal(moved.turn, Side.BLACK);
  assert.equal(moved.moveLog.length, 1);
});

test('match protocol supports sync, ack, draw and resign flows', () => {
  let room = createMatchRoom({ roomId: 'room-2', selfId: 'u-red', selfSide: Side.RED, mode: MatchMode.ONLINE, state: MatchState.PLAYING });
  room = applyMatchEvent(room, createSyncEvent({ roomId: 'room-2', senderId: 'u-black', board: { snapshot: true }, turn: Side.RED, moveSeq: 7 }));
  assert.equal(room.state, MatchState.SYNCHRONIZING);
  assert.equal(room.sequence, 7);

  room = applyMatchEvent(room, createAckEvent({ roomId: 'room-2', senderId: 'u-black', ackSeq: 7 }));
  assert.equal(room.lastAckSeq, 7);

  room = applyMatchEvent(room, createDrawOfferEvent({ roomId: 'room-2', senderId: 'u-black' }));
  assert.equal(room.pendingDraw, true);

  room = applyMatchEvent(room, createResignEvent({ roomId: 'room-2', senderId: 'u-black' }));
  assert.equal(room.state, MatchState.FINISHED);
  assert.equal(room.result.reason, 'resign');
  assert.equal(room.result.winner, Side.RED);
});

test('describeMatchRoom summarizes state cleanly', () => {
  const room = createMatchRoom({ roomId: 'room-3', selfId: 'u-red', selfSide: Side.RED });
  const summary = describeMatchRoom(room);
  assert.deepEqual(summary.roomId, 'room-3');
  assert.equal(summary.state, MatchState.IDLE);
  assert.equal(summary.selfSide, Side.RED);
});
