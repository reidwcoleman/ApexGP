// Do the servers that introduce two browsers answer? STUN finds a browser's public address (enough for most home
// routers); TURN relays when two routers will not talk directly.   node tools/lastframe/turncheck.mjs
import { chromium } from 'playwright-core';
import { CHROME } from '../chrome.mjs';
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await b.newPage();
await p.goto('about:blank');
const out = await p.evaluate(async () => {
  const test = (iceServers, policy) => new Promise((res) => {
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
    const kinds = new Set();
    pc.createDataChannel('x');
    pc.onicecandidate = (e) => { if (e.candidate) kinds.add(e.candidate.type); };
    pc.createOffer().then((o) => pc.setLocalDescription(o));
    setTimeout(() => { pc.close(); res([...kinds]); }, 7000);
  });
  return {
    stun: await test([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }], 'all'),
    turn: await test([{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }], 'relay'),
  };
});
console.log(JSON.stringify(out));
console.log(out.stun.includes('srflx') ? 'STUN answers: direct connections can be set up' : 'STUN did not answer');
console.log(out.turn.includes('relay') ? 'TURN answers: relayed connections work' : 'TURN does not answer: no relay for strict networks');
await b.close();
