"use client";

import { useState, useRef } from "react";

// 1. Define the exact structure of our Matchmaker's messages
interface SignalData {
  type: "joined" | "error" | "offer" | "ice_candidate";
  room?: string;
  message?: string;
  sdp?: string; // Changed from 'any' to the strict WebRTC type
  candidate?: RTCIceCandidateInit;
}

export default function Home() {
  const [roomId, setRoomId] = useState<string>("");
  const [status, setStatus] = useState<string>(
    "Enter the 4-digit code from the terminal",
  );
  const [fileName, setFileName] = useState<string>("peerdrop_file");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // 2. Strongly type our mutable references
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const receiveBuffer = useRef<ArrayBuffer[]>([]);

  const connectAndJoin = () => {
    setStatus("Connecting to Matchmaker...");

    const ws = new WebSocket("wss://peerdrop-server.onrender.com");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", room: roomId }));
    };

    ws.onmessage = async (message: MessageEvent) => {
      const data: SignalData = JSON.parse(message.data);

      if (data.type === "joined") {
        setStatus("Joined room! Waiting for PC to send file...");
        setupWebRTC();
      } else if (data.type === "error") {
        setStatus(`Error: ${data.message}`);
      } else if (data.type === "offer" && data.sdp) {
        setStatus("Received connection offer. Securing tunnel...");

        if (!pcRef.current) return;

        // THE FIX: Explicitly construct the object WebRTC expects
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription({
            type: "offer",
            sdp: data.sdp,
          }),
        );

        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);

        ws.send(
          JSON.stringify({ type: "answer", room: roomId, sdp: answer.sdp }),
        );
      } else if (data.type === "ice_candidate" && data.candidate) {
        if (!pcRef.current) return;
        await pcRef.current.addIceCandidate(
          new RTCIceCandidate(data.candidate),
        );
      }
    };
  };

  const setupWebRTC = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice_candidate",
            room: roomId,
            candidate: event.candidate,
          }),
        );
      }
    };

    pc.ondatachannel = (event: RTCDataChannelEvent) => {
      const receiveChannel = event.channel;

      // CRITICAL: Do NOT set binaryType = 'arraybuffer' here.
      // We need the browser to handle both JSON strings and Binary Blobs.

      setStatus("Connection established! Waiting for metadata...");

      receiveChannel.onmessage = async (e: MessageEvent) => {
        // 1. Metadata (String)
        if (typeof e.data === "string") {
          try {
            const meta = JSON.parse(e.data);
            if (meta.fileName) {
              setFileName(meta.fileName);
              setStatus(`Receiving: ${meta.fileName}...`);
            }
          } catch (err) {
            console.error("Error parsing metadata:", err);
          }
        }
        // 2. Binary Data
        else {
          let buffer: ArrayBuffer;

          if (e.data instanceof Blob) {
            // If it's a Blob, convert it to ArrayBuffer
            buffer = await e.data.arrayBuffer();
          } else if (e.data instanceof ArrayBuffer) {
            // If it's already an ArrayBuffer, use it directly
            buffer = e.data;
          } else {
            // Fallback for typed arrays
            buffer = e.data.buffer || e.data;
          }

          if (buffer.byteLength > 0) {
            receiveBuffer.current.push(buffer);
          }
        }
      };

      receiveChannel.onclose = () => {
        setStatus("Transfer Complete! Preparing your download...");

        // 3. Combine chunks into a single file
        const blob = new Blob(receiveBuffer.current);
        const url = URL.createObjectURL(blob);

        setDownloadUrl(url);
        setStatus("File ready!");

        if (wsRef.current) wsRef.current.close();
      };
    };
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white p-6">
      <div className="max-w-md w-full bg-gray-800 rounded-xl shadow-2xl p-8 space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-blue-400">
          PeerDrop
        </h1>
        <p className="text-gray-400 text-sm">Zero-Install P2P File Transfer</p>

        <div className="space-y-4 pt-4">
          <input
            type="text"
            maxLength={4}
            placeholder="0000"
            className="w-full bg-gray-700 text-white text-center text-3xl tracking-[0.5em] rounded-lg py-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.replace(/\D/g, ""))}
          />

          <button
            onClick={connectAndJoin}
            disabled={roomId.length !== 4}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors py-3 rounded-lg font-semibold text-lg"
          >
            Connect
          </button>
        </div>

        <div className="pt-6 border-t border-gray-700">
          <p className="text-sm text-yellow-400 font-mono animate-pulse">
            {status}
          </p>
        </div>

        {downloadUrl && (
          <div className="pt-4 animate-bounce">
            <a
              href={downloadUrl}
              download={fileName} // This ensures the extension (.pdf) is preserved!
              className="inline-block bg-green-500 hover:bg-green-400 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform"
            >
              ⬇️ Save {fileName}
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
