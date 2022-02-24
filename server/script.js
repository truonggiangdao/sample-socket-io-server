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

const socket = io("ws://" + window.location.host);

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
  console.log('a1');
  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = (ev) => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
    if (peerConn.connectionState === "closed" || peerConn.connectionState === "disconnected" || peerConn.connectionState === "failed") {
      console.log(`Cleaning up ${sessionId}`);
      peers.delete(sessionId);
      showPeers();
    }
  };
  console.log('a2');
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate !== null) {
      publishSignalingMsg(sessionId, {
        kind: "ice-candidate",
        fromSessionId: mySessionId,
        candidate: ev.candidate
      });
    }
  };
  console.log('a3');
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
  console.log('b1');
  setUpDataChannel(peer.peerConn.createDataChannel("myDataChannel"), peer);
  console.log('b2');
  const desc = await peer.peerConn.createOffer();
  console.log('b3');
  await peer.peerConn.setLocalDescription(desc);
  console.log('b4');
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
  console.log('1');
  if (peer.peerConn.remoteDescription) {
    console.warn("Received a second offer from the same peer", peer);
  }
  console.log('2');
  peer.peerConn.ondatachannel = (dataChannelEv) => {
    setUpDataChannel(dataChannelEv.channel, peer);
  };
  console.log('3');
  await setRemoteDescription(peer, signalingMsgOffer.offer);
  console.log('4');
  const answerDesc = await peer.peerConn.createAnswer();
  console.log('5');
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
  console.log("Setting answer");
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
  // await Promise.all([
  //   ablyChatRoomHelloChannel.subscribe((ablyMessage) => {
  //     if (!ablyMessage.data)
  //       return;
  //     const signalingMsg = ablyMessage.data;
  //     handleHello(signalingMsg.fromSessionId);
  //   }),
  //   ablyMyPrivateChannel.subscribe((ablyMessage) => {
  //     const signalingMsg = ablyMessage.data;
  //     if (signalingMsg.kind === "offer") {
  //       handleSignalingMsgOffer(signalingMsg);
  //     } else if (signalingMsg.kind === "answer") {
  //       handleSignalingMsgAnswer(signalingMsg);
  //     } else if (signalingMsg.kind === "ice-candidate") {
  //       handleSignalingMsgIceCandidate(signalingMsg);
  //     } else {
  //       assertUnreachable(signalingMsg);
  //     }
  //   })
  // ]);
  console.log("Subscribed to all channels");
  // ablyChatRoomHelloChannel.publish("hello", msg);

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

  // or with emit() and custom event names
  // socket.emit("salutations", "Hello!", { "mr": "john" }, Uint8Array.from([1, 2, 3, 4]));
});

socket.on('hello', signalingMsg => {
  console.log("from hello", signalingMsg);
  handleHello(signalingMsg.fromSessionId);
});


// ablyClient.connect();
// ablyClient.connection.on("connected", async () => {
  
// });
// ablyClient.connection.on("failed", () => {
//   console.error("Ably connection failed");
// });
