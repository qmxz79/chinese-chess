const {
  createAckEvent,
  createDrawOfferEvent,
  createDrawResponseEvent,
  createErrorEvent,
  createHeartbeatEvent,
  createMatchAccept,
  createMatchRequest,
  createMatchRoom,
  createMoveEvent,
  createResignEvent,
  createSyncEvent,
  isProtocolEnvelope,
  applyMatchEvent,
} = require('./match-protocol');

const TransportStatus = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed',
  ERROR: 'error',
});

function safeJsonParse(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function buildWxSocketAdapter(wxApi = typeof wx !== 'undefined' ? wx : null) {
  if (!wxApi || typeof wxApi.connectSocket !== 'function') {
    throw new Error('wx socket API is unavailable');
  }

  return {
    open(url, handlers = {}) {
      const task = wxApi.connectSocket({ url });
      const bind = (method, handler) => {
        if (task && typeof task[method] === 'function') task[method](handler);
      };

      bind('onOpen', (event) => handlers.onOpen && handlers.onOpen(event));
      bind('onClose', (event) => handlers.onClose && handlers.onClose(event));
      bind('onError', (event) => handlers.onError && handlers.onError(event));
      bind('onMessage', (event) => handlers.onMessage && handlers.onMessage(event && event.data));

      return {
        send(data) {
          if (task && typeof task.send === 'function') {
            task.send({
              data,
              success: (res) => handlers.onSendSuccess && handlers.onSendSuccess(res),
              fail: (err) => handlers.onSendError && handlers.onSendError(err),
            });
            return;
          }
          if (typeof wxApi.sendSocketMessage === 'function') {
            wxApi.sendSocketMessage({
              data,
              success: (res) => handlers.onSendSuccess && handlers.onSendSuccess(res),
              fail: (err) => handlers.onSendError && handlers.onSendError(err),
            });
          }
        },
        close(code = 1000, reason = 'client close') {
          if (task && typeof task.close === 'function') {
            task.close({ code, reason });
            return;
          }
          if (typeof wxApi.closeSocket === 'function') {
            wxApi.closeSocket({ code, reason });
          }
        },
      };
    },
  };
}

function createMatchSignalClient({
  room = createMatchRoom(),
  url = '',
  adapter = null,
  onRoomChange = null,
  onTransportChange = null,
  onEnvelope = null,
  onError = null,
} = {}) {
  const listeners = {
    roomChange: onRoomChange,
    transportChange: onTransportChange,
    envelope: onEnvelope,
    error: onError,
  };

  let transport = null;
  let transportState = {
    status: TransportStatus.IDLE,
    url,
    lastError: null,
    connectedAt: null,
    closedAt: null,
    lastMessageAt: null,
  };
  let roomState = room;

  const socketAdapter = adapter || (typeof wx !== 'undefined' ? buildWxSocketAdapter(wx) : null);

  function emit(kind, payload, extra) {
    const handler = listeners[kind];
    if (typeof handler === 'function') handler(payload, extra);
  }

  function setTransportState(patch) {
    transportState = { ...transportState, ...patch };
    emit('transportChange', transportState, clientApi);
  }

  function setRoomState(nextRoom, envelope = null) {
    roomState = nextRoom;
    emit('roomChange', roomState, envelope, clientApi);
  }

  function handleEnvelope(envelope) {
    if (!isProtocolEnvelope(envelope)) {
      const error = { code: 'INVALID_ENVELOPE', message: 'not a valid protocol envelope', raw: envelope };
      setTransportState({ status: TransportStatus.ERROR, lastError: error });
      emit('error', error, clientApi);
      return;
    }

    const nextRoom = applyMatchEvent(roomState, envelope);
    setRoomState(nextRoom, envelope);
    setTransportState({ lastMessageAt: envelope.ts || Date.now(), lastError: null });
    emit('envelope', envelope, clientApi);
  }

  function sendEnvelope(envelope) {
    if (!transport || transportState.status !== TransportStatus.OPEN) return false;
    try {
      transport.send(JSON.stringify(envelope));
      return true;
    } catch (error) {
      const normalized = { code: 'SEND_ERROR', message: error && error.message ? error.message : 'failed to send socket message', event: error || null };
      setTransportState({ status: TransportStatus.ERROR, lastError: normalized });
      emit('error', normalized, clientApi);
      return false;
    }
  }

  const clientApi = {
    getTransportState: () => transportState,
    getRoom: () => roomState,
    setHandlers(nextHandlers = {}) {
      Object.assign(listeners, nextHandlers);
      return clientApi;
    },
    connect(nextUrl = transportState.url) {
      if (!socketAdapter) {
        const error = { code: 'ADAPTER_MISSING', message: 'socket adapter is unavailable' };
        setTransportState({ status: TransportStatus.ERROR, lastError: error });
        emit('error', error, clientApi);
        return false;
      }
      if (!nextUrl) {
        const error = { code: 'EMPTY_URL', message: 'signaling url is empty' };
        setTransportState({ status: TransportStatus.ERROR, lastError: error });
        emit('error', error, clientApi);
        return false;
      }

      if (transport) {
        clientApi.disconnect();
      }

      setTransportState({ status: TransportStatus.CONNECTING, url: nextUrl, lastError: null });
      transport = socketAdapter.open(nextUrl, {
        onOpen() {
          setTransportState({ status: TransportStatus.OPEN, connectedAt: Date.now(), lastError: null });
        },
        onMessage(raw) {
          const parsed = safeJsonParse(raw);
          if (!parsed) {
            const error = { code: 'PARSE_ERROR', message: 'message is not valid JSON', raw };
            setTransportState({ status: TransportStatus.ERROR, lastError: error });
            emit('error', error, clientApi);
            return;
          }
          handleEnvelope(parsed);
        },
        onClose(event) {
          setTransportState({ status: TransportStatus.CLOSED, closedAt: Date.now(), lastError: null, closeEvent: event || null });
          transport = null;
        },
        onError(event) {
          const error = { code: 'SOCKET_ERROR', message: 'socket error', event: event || null };
          setTransportState({ status: TransportStatus.ERROR, lastError: error });
          emit('error', error, clientApi);
        },
        onSendError(err) {
          const error = { code: 'SEND_ERROR', message: 'failed to send socket message', event: err || null };
          setTransportState({ status: TransportStatus.ERROR, lastError: error });
          emit('error', error, clientApi);
        },
      });

      return true;
    },
    disconnect() {
      if (!transport) {
        setTransportState({ status: TransportStatus.CLOSED, closedAt: Date.now() });
        return true;
      }
      setTransportState({ status: TransportStatus.CLOSING });
      try {
        transport.close();
      } finally {
        transport = null;
        setTransportState({ status: TransportStatus.CLOSED, closedAt: Date.now() });
      }
      return true;
    },
    sendEnvelope,
    sendMatchRequest(desiredSide = roomState.selfSide, seed = roomState.seed) {
      return sendEnvelope(createMatchRequest({
        roomId: roomState.roomId,
        senderId: roomState.selfId,
        desiredSide,
        seed,
      }));
    },
    sendMatchAccept(opponentId = roomState.opponentId, selfSide = roomState.selfSide, seed = roomState.seed) {
      return sendEnvelope(createMatchAccept({
        roomId: roomState.roomId,
        senderId: roomState.selfId,
        opponentId,
        selfSide,
        seed,
      }));
    },
    sendMove(move, meta = {}) {
      return sendEnvelope(createMoveEvent({ roomId: roomState.roomId, senderId: roomState.selfId, move, seq: meta.seq || roomState.sequence }));
    },
    sendAck(ackSeq, hash = null) {
      return sendEnvelope(createAckEvent({ roomId: roomState.roomId, senderId: roomState.selfId, ackSeq, hash }));
    },
    sendSync(board, turn, moveSeq = 0) {
      return sendEnvelope(createSyncEvent({ roomId: roomState.roomId, senderId: roomState.selfId, board, turn, moveSeq }));
    },
    sendHeartbeat(ping = Date.now()) {
      return sendEnvelope(createHeartbeatEvent({ roomId: roomState.roomId, senderId: roomState.selfId, ping }));
    },
    sendDrawOffer() {
      return sendEnvelope(createDrawOfferEvent({ roomId: roomState.roomId, senderId: roomState.selfId }));
    },
    sendDrawResponse(accepted = false) {
      return sendEnvelope(createDrawResponseEvent({ roomId: roomState.roomId, senderId: roomState.selfId, accepted }));
    },
    sendResign() {
      return sendEnvelope(createResignEvent({ roomId: roomState.roomId, senderId: roomState.selfId }));
    },
    sendError(code, message) {
      return sendEnvelope(createErrorEvent({ roomId: roomState.roomId, senderId: roomState.selfId, code, message }));
    },
    ingest(raw) {
      const parsed = safeJsonParse(raw);
      if (!parsed) return false;
      handleEnvelope(parsed);
      return true;
    },
    applyIncomingEnvelope(envelope) {
      handleEnvelope(envelope);
      return roomState;
    },
    dispose() {
      clientApi.disconnect();
    },
  };

  return clientApi;
}

module.exports = {
  TransportStatus,
  safeJsonParse,
  buildWxSocketAdapter,
  createMatchSignalClient,
};
