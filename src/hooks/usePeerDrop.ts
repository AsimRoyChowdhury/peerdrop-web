import { useState, useRef } from "react";
import { encryptSdp, decryptSdp } from "../utils/crypto";

export type AppState = "idle" | "hosting" | "joining" | "transferring" | "paused" | "complete" | "error";

interface TransferMetrics {
  fileName: string;
  fileSize: number;
  progress: number;
  speed: string;
  downloadUrl: string | null;
  peerDeviceName: string; // NEW: Device Fingerprint
}

// NEW: Device Name Parser
const getDeviceName = () => {
  if (typeof window === "undefined") return "Unknown Device";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android Device";
  if (/Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Web Browser";
};

export function usePeerDrop() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [displayCode, setDisplayCode] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [metrics, setMetrics] = useState<TransferMetrics>({
    fileName: "", fileSize: 0, progress: 0, speed: "0 B/s", downloadUrl: null, peerDeviceName: "Unknown Device"
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  
  const publicRoomRef = useRef<string>("");
  const privatePinRef = useRef<string>("");
  const fileToSendRef = useRef<File | null>(null);
  
  const receiveBufferRef = useRef<ArrayBuffer[]>([]);
  const bytesTransferredRef = useRef(0);
  const expectedFileNameRef = useRef<string>("");
  const expectedFileSizeRef = useRef<number>(0);
  const speedTrackerRef = useRef({ lastTime: 0, lastBytes: 0 });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const updateMetrics = (newBytes: number, totalSize: number) => {
    bytesTransferredRef.current = newBytes;
    const now = performance.now();
    const timeDiff = now - speedTrackerRef.current.lastTime;
    
    if (timeDiff > 500) {
      const speedRaw = (newBytes - speedTrackerRef.current.lastBytes) / (timeDiff / 1000);
      const speedStr = `${formatBytes(speedRaw)}/s`;
      const progressPct = totalSize === 0 ? 0 : Math.min(100, Math.round((newBytes / totalSize) * 100));
      
      setMetrics(prev => ({ ...prev, progress: progressPct, speed: speedStr }));
      speedTrackerRef.current = { lastTime: now, lastBytes: newBytes };
    }
  };

  const executeSendLoop = async () => {
    const file = fileToSendRef.current;
    const dc = dcRef.current;
    if (!file || !dc) return;

    dc.binaryType = "arraybuffer";
    
    const bufferThreshold = 1024 * 1024; 
    const chunkSize = 16384; 

    // NEW: Host sends their device name alongside the file metadata
    dc.send(JSON.stringify({ 
      fileName: file.name, 
      fileSize: file.size,
      senderDeviceName: getDeviceName() 
    }));

    const sendStream = async (resumeFrom: number) => {
      try {
        let offset = resumeFrom;
        const fileToStream = resumeFrom > 0 ? file.slice(resumeFrom) : file;
        const reader = fileToStream.stream().getReader();

        while (true) {
          if (dc.readyState !== "open") throw new Error("Connection dropped");

          const { done, value } = await reader.read();

          if (done) {
            while (dc.bufferedAmount > 0) {
              if (dc.readyState !== "open") throw new Error("Connection dropped");
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            setMetrics(prev => ({ ...prev, progress: 100, speed: "0 B/s" }));
            setAppState("complete");
            setStatusMsg("Transfer successful.");
            dc.close(); 
            break;
          }

          for (let i = 0; i < value.length; i += chunkSize) {
            if (dc.readyState !== "open") throw new Error("Connection dropped");
            while (dc.bufferedAmount > bufferThreshold) {
              if (dc.readyState !== "open") throw new Error("Connection dropped");
              await new Promise(resolve => setTimeout(resolve, 5));
            }
            const chunk = value.slice(i, i + chunkSize);
            dc.send(chunk);
            offset += chunk.length;
            updateMetrics(offset, file.size);
          }
        }
      } catch (error) {
        console.warn("Transfer paused/dropped:", error);
        setStatusMsg("Connection lost. Waiting for receiver...");
      }
    };

    dc.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        
        if (msg.type === "ready") {
          // NEW: Save the Receiver's device name when they say they are ready
          if (msg.receiverDeviceName) {
            setMetrics(prev => ({ ...prev, peerDeviceName: msg.receiverDeviceName }));
          }
          setAppState("transferring");
          speedTrackerRef.current.lastTime = performance.now();
          sendStream(msg.resumeFrom || 0);
        } else if (msg.type === "error") {
          setStatusMsg(msg.message);
          setAppState("error");
          setTimeout(() => dc.close(), 500);
        }
      }
    };
  };

  const setupWebRTC = (isHost: boolean, targetRoom: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        if (!isHost && bytesTransferredRef.current < expectedFileSizeRef.current && expectedFileSizeRef.current > 0) {
          setStatusMsg(`Sender disconnected abruptly.`);
          setAppState("paused");
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: "ice_candidate", room: targetRoom, candidate: event.candidate }));
      }
    };

    if (isHost) {
      const dc = pc.createDataChannel("file-transfer");
      dcRef.current = dc;
      dc.onopen = executeSendLoop;
    } else {
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dc.binaryType = "arraybuffer"; 
        dcRef.current = dc;
        
        dc.onmessage = async (e) => {
          if (typeof e.data === "string") {
            const meta = JSON.parse(e.data);
            if (meta.fileName) {
              
              // NEW: Save the Sender's Device Name
              if (meta.senderDeviceName) {
                setMetrics(prev => ({ ...prev, peerDeviceName: meta.senderDeviceName }));
              }

              if (expectedFileSizeRef.current > 0) {
                if (meta.fileName === expectedFileNameRef.current && meta.fileSize === expectedFileSizeRef.current) {
                  setStatusMsg("Match found! Resuming transfer...");
                  setAppState("transferring");
                  // Send Receiver name back to Sender
                  dc.send(JSON.stringify({ type: "ready", resumeFrom: bytesTransferredRef.current, receiverDeviceName: getDeviceName() }));
                } else {
                  setStatusMsg(`File Mismatch! Expected: ${expectedFileNameRef.current}`);
                  setAppState("paused"); 
                  dc.send(JSON.stringify({ type: "error", message: `You selected the wrong file. Expected: ${expectedFileNameRef.current}` }));
                  setTimeout(() => dc.close(), 500); 
                }
              } else {
                expectedFileNameRef.current = meta.fileName;
                expectedFileSizeRef.current = meta.fileSize;
                setMetrics(prev => ({ ...prev, fileName: meta.fileName, fileSize: meta.fileSize, progress: 0 }));
                setAppState("transferring");
                receiveBufferRef.current = [];
                bytesTransferredRef.current = 0;
                speedTrackerRef.current.lastTime = performance.now();
                dc.send(JSON.stringify({ type: "ready", resumeFrom: 0, receiverDeviceName: getDeviceName() }));
              }
            }
          } else {
            const buffer = e.data; 
            receiveBufferRef.current.push(buffer);
            updateMetrics(bytesTransferredRef.current + buffer.byteLength, expectedFileSizeRef.current);
          }
        };

        dc.onclose = () => {
          if (bytesTransferredRef.current >= expectedFileSizeRef.current && expectedFileSizeRef.current > 0) {
            const blob = new Blob(receiveBufferRef.current, { type: "application/octet-stream" });
            setMetrics(prev => ({ ...prev, progress: 100, speed: "0 B/s", downloadUrl: URL.createObjectURL(blob) }));
            setAppState("complete");
            setStatusMsg("File ready for download.");
          } else if (expectedFileSizeRef.current > 0) {
            setStatusMsg("Sender disconnected. Enter their new PIN to resume.");
            setAppState("paused");
          }
        };
      };
    }
  };

  const initiateSend = (file: File) => {
    fileToSendRef.current = file;
    setMetrics(prev => ({ ...prev, fileName: file.name, fileSize: file.size }));
    setAppState("hosting");

    const privatePin = Math.floor(1000 + Math.random() * 9000).toString();
    privatePinRef.current = privatePin;
    
    setDisplayCode(""); 
    setStatusMsg("Generating Secure Code...");

    const ws = new WebSocket("wss://peerdrop-server.onrender.com");
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "create" }));
    
    ws.onmessage = async (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "room_created") {
        publicRoomRef.current = data.room; 
        setDisplayCode(`${data.room}${privatePin}`);
        setStatusMsg("Awaiting secure connection...");
      } else if (data.type === "peer_joined") {
        setupWebRTC(true, publicRoomRef.current);
        const offer = await pcRef.current!.createOffer();
        await pcRef.current!.setLocalDescription(offer);
        const encSdp = await encryptSdp(offer.sdp!, privatePinRef.current);
        ws.send(JSON.stringify({ type: "offer", room: publicRoomRef.current, sdp: encSdp }));
      } else if (data.type === "answer" && data.sdp) {
        const decSdp = await decryptSdp(data.sdp, privatePinRef.current);
        await pcRef.current!.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: decSdp }));
      } else if (data.type === "ice_candidate") {
        await pcRef.current!.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };
  };

  const initiateReceive = (code: string) => {
    if (code.length !== 8) return;
    setAppState("joining");
    setStatusMsg("Establishing secure tunnel...");

    publicRoomRef.current = code.substring(0, 4);
    privatePinRef.current = code.substring(4, 8);

    const ws = new WebSocket("wss://peerdrop-server.onrender.com");
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "join", room: publicRoomRef.current }));

    ws.onmessage = async (message) => {
      const data = JSON.parse(message.data);
      if (data.type === "joined") {
        setupWebRTC(false, publicRoomRef.current);
      } else if (data.type === "offer" && data.sdp) {
        try {
          const decSdp = await decryptSdp(data.sdp, privatePinRef.current);
          await pcRef.current!.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: decSdp }));
          const answer = await pcRef.current!.createAnswer();
          await pcRef.current!.setLocalDescription(answer);
          const encSdp = await encryptSdp(answer.sdp!, privatePinRef.current);
          ws.send(JSON.stringify({ type: "answer", room: publicRoomRef.current, sdp: encSdp }));
        } catch {
          setStatusMsg("Decryption failed. Invalid security pin.");
          setAppState(expectedFileSizeRef.current > 0 ? "paused" : "idle");
        }
      } else if (data.type === "ice_candidate") {
        await pcRef.current!.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };
  };

  const resetState = () => {
    if (wsRef.current) wsRef.current.close();
    if (pcRef.current) pcRef.current.close();
    setAppState("idle");
    setMetrics({ fileName: "", fileSize: 0, progress: 0, speed: "0 B/s", downloadUrl: null, peerDeviceName: "Unknown Device" });
    
    expectedFileNameRef.current = "";
    expectedFileSizeRef.current = 0;
    receiveBufferRef.current = [];
    bytesTransferredRef.current = 0;
  };

  return {
    appState, displayCode, statusMsg, metrics, 
    initiateSend, initiateReceive, resetState
  };
}