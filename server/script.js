import { io } from './socket.io.esm.min.js';

function assertUnreachable(x) {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

const peersEl = document.getElementById("peers");
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer");
const mySessionId = Math.random().toString();
console.log("I am:", mySessionId);
const peers = new Map();
window.peers = peers;

function show(msg) {
  const newMsgEl = document.createElement("div");
  newMsgEl.innerText = msg;
  msgsEl?.appendChild(newMsgEl);
}

msgBufferInputEl.onkeydown = (ev) => {
  if (ev.key === "Enter") {
    const msg = msgBufferInputEl.value;
    msgBufferInputEl.value = "";
    show(msg);
    for (const [sessionId, {dataChannel}] of peers.entries()) {
      if (dataChannel === void 0) {
        console.warn(`Could not send to ${sessionId}; no data channel`);
        continue;
      }
      try {
        dataChannel.send(msg);
      } catch (err) {
        console.error(`Error sending to ${sessionId}: ${err}`);
      }
    }
  }
};

const socket = io("https://" + window.location.host);

function publishSignalingMsg(toSessionId, signalingMsg) {
  console.log("Sending to", toSessionId, ":", signalingMsg);
  if (signalingMsg.kind === 'offer') {
    socket.emit('offer', { target: toSessionId, data: signalingMsg });
  }
  if (signalingMsg.kind === 'answer') {
    socket.emit('answer', { target: toSessionId, data: signalingMsg });
  }
  if (signalingMsg.kind === 'ice-candidate') {
    socket.emit('ice-candidate', { target: toSessionId, data: signalingMsg });
  }
}
function showPeers() {
  peersEl.innerText = [...peers.keys()].join(", ");
}
function newPeerConnection() {
  return new RTCPeerConnection({iceServers: [{urls: ["stun:stun.l.google.com:19302"]}]});
}
function newPeer(sessionId) {
  if (peers.has(sessionId)) {
    throw new Error(`Error: we already have a peer with sessionId ${sessionId}`);
  }
  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = (ev) => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
    if (peerConn.connectionState === "closed" || peerConn.connectionState === "disconnected" || peerConn.connectionState === "failed") {
      console.log(`Cleaning up ${sessionId}`);
      peers.delete(sessionId);
      showPeers();
    }
  };
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate !== null) {
      publishSignalingMsg(sessionId, {
        kind: "ice-candidate",
        fromSessionId: mySessionId,
        candidate: ev.candidate
      });
    }
  };
  const peer = { id: sessionId, peerConn, iceCandidateBuffer: [], dataChannel: void 0 };
  peers.set(sessionId, peer);
  showPeers();
  return peer;
}

function setUpDataChannel(dataChannel, peer) {
  peer.dataChannel = dataChannel;
  dataChannel.onmessage = (msgEv) => show(`${peer.id} says: ${msgEv.data}`);
}
async function handleHello(remoteSessionId) {
  if (remoteSessionId === mySessionId)
    return;
  if (peers.has(remoteSessionId)) {
    throw new Error("Received hello from existing peer!");
  }
  console.log("Received hello from", remoteSessionId);
  const peer = newPeer(remoteSessionId);
  setUpDataChannel(peer.peerConn.createDataChannel("myDataChannel"), peer);
  const desc = await peer.peerConn.createOffer();
  await peer.peerConn.setLocalDescription(desc);
  publishSignalingMsg(remoteSessionId, {
    kind: "offer",
    fromSessionId: mySessionId,
    offer: desc
  });
}

function getOrCreatePeer(remoteSessionId) {
  return peers.get(remoteSessionId) || newPeer(remoteSessionId);
}

async function setRemoteDescription(peer, description) {
  await peer.peerConn.setRemoteDescription(description);
  if (!peer.peerConn.remoteDescription) {
    throw new Error("remoteDescription not set after setting");
  }
  for (const candidate of peer.iceCandidateBuffer) {
    await peer.peerConn.addIceCandidate(candidate);
  }
  peer.iceCandidateBuffer = [];
}

async function handleSignalingMsgOffer(signalingMsgOffer) {
  if (signalingMsgOffer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  if (peer.peerConn.remoteDescription) {
    console.warn("Received a second offer from the same peer", peer);
  }
  peer.peerConn.ondatachannel = (dataChannelEv) => {
    setUpDataChannel(dataChannelEv.channel, peer);
  };
  await setRemoteDescription(peer, signalingMsgOffer.offer);
  const answerDesc = await peer.peerConn.createAnswer();
  await peer.peerConn.setLocalDescription(answerDesc);
  publishSignalingMsg(signalingMsgOffer.fromSessionId, {
    kind: "answer",
    fromSessionId: mySessionId,
    answer: answerDesc
  });
}
async function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);
  const peer = peers.get(fromSessionId);
  if (peer === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  if (peer.peerConn.remoteDescription) {
    console.warn("Received a second offer from the same peer", peer);
  }
  await setRemoteDescription(peer, signalingMsgAnswer.answer);
}

async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  if (peer.peerConn.remoteDescription) {
    await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
  } else {
    peer.iceCandidateBuffer.push(signalingMsgIceCandidate.candidate);
  }
}

socket.on("connect", () => {
  console.log("Connected to Socket");

  socket.on('offer', signalingMsg => {
    console.log("from offer", signalingMsg);
    handleSignalingMsgOffer(signalingMsg.data);
  });

  socket.on('answer', signalingMsg => {
    console.log("from answer", signalingMsg);
    handleSignalingMsgAnswer(signalingMsg.data);
  });

  socket.on('ice-candidate', signalingMsg => {
    console.log("from ice-candidate", signalingMsg);
    handleSignalingMsgIceCandidate(signalingMsg.data);
  });

  const msg = {fromSessionId: mySessionId};
  console.log("Publishing hello", msg);
  socket.emit('hello', msg);
});

socket.on('hello', signalingMsg => {
  console.log("from hello", signalingMsg);
  handleHello(signalingMsg.fromSessionId);
});
