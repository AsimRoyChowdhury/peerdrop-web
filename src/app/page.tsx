"use client";

import { useState, useRef, useEffect } from "react";

interface SignalData {
  type: "joined" | "error" | "offer" | "ice_candidate";
  room?: string;
  message?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function Home() {
  type ErrorState = { title: string; solution: string } | null;

  const [roomId, setRoomId] = useState<string>("");
  const [status, setStatus] = useState<string>(
    "Enter the 4-digit code from the terminal",
  );
  const [fileName, setFileName] = useState<string>("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [fileSize, setFileSize] = useState<number>(0);
  const [receivedBytes, setReceivedBytes] = useState<number>(0);
  const [transferSpeed, setTransferSpeed] = useState<string>("0 B/s");

  const [isDisconnected, setIsDisconnected] = useState<boolean>(false);
  const [appError, setAppError] = useState<ErrorState>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // Notice we don't clear these on re-connect!
  const receiveBuffer = useRef<ArrayBuffer[]>([]);
  const expectedFileName = useRef<string>("");

  const speedTracker = useRef({ lastUpdateTime: 0, lastBytes: 0 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicCode = params.get("code");

    if (magicCode && magicCode.length === 4) {
      setRoomId(magicCode);
      setStatus("Magic link detected! Auto-connecting...");

      // Auto-trigger the connection
      connectAndJoin(magicCode);

      // Clean up the URL so it looks clean (removes the ?code=1234)
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerError = (type: "firewall" | "room" | "memory") => {
    const errors = {
      firewall: {
        title: "Connection Timeout (Strict NAT)",
        solution:
          "Connect to a different network or use a VPN.",
      },
      room: {
        title: "Session Expired",
        solution:
          "Ask the sender to restart the terminal app and generate a fresh code.",
      },
      memory: {
        title: "Memory Limit Reached",
        solution:
          "Close unused tabs to free up RAM, or use a desktop Chromium browser.",
      },
    };
    setAppError(errors[type]);
    setIsDisconnected(true);
  };

  const connectAndJoin = (overrideRoom?: string) => {
    const targetRoom = overrideRoom || roomId;

    setStatus("Connecting to Matchmaker...");
    setIsDisconnected(false); // Reset warning

    const ws = new WebSocket("wss://peerdrop-server.onrender.com");
    wsRef.current = ws;

    ws.onopen = () =>
      ws.send(JSON.stringify({ type: "join", room: targetRoom }));

    ws.onmessage = async (message: MessageEvent) => {
      const data: SignalData = JSON.parse(message.data);
      if (data.type === "joined") {
        setStatus("Joined room! Negotiating tunnel...");
        setupWebRTC();
      } else if (data.type === "error") {
        setStatus(`Error: ${data.message}`);
        triggerError("room");
      } else if (data.type === "offer" && data.sdp) {
        if (!pcRef.current) return;
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription({ type: "offer", sdp: data.sdp }),
        );
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        ws.send(
          JSON.stringify({ type: "answer", room: targetRoom, sdp: answer.sdp }),
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

    // --- NEW: CONNECTION HEALTH MONITOR ---
    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed"
      ) {
        setStatus("Sender disconnected. Ask them to restart app to resume.");
        triggerError("firewall");
      }
    };

    pc.onicecandidate = (event) => {
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

    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;

      receiveChannel.onmessage = async (e: MessageEvent) => {
        if (typeof e.data === "string") {
          const meta = JSON.parse(e.data);

          if (meta.fileName && meta.fileSize) {
            setFileName(meta.fileName);
            setFileSize(meta.fileSize);

            // --- NEW: RESUME HANDSHAKE LOGIC ---
            let resumeBytes = 0;
            // If the incoming file matches what we were already downloading, resume!
            if (expectedFileName.current === meta.fileName) {
              resumeBytes = receiveBuffer.current.reduce(
                (acc, val) => acc + val.byteLength,
                0,
              );
              setStatus(
                `Resuming: ${meta.fileName} from ${formatBytes(resumeBytes)}...`,
              );
            } else {
              // It's a new file. Clear out old data.
              receiveBuffer.current = [];
              expectedFileName.current = meta.fileName;
              setReceivedBytes(0);
              setStatus(`Receiving: ${meta.fileName}...`);
            }

            // Tell Rust to start sending!
            receiveChannel.send(
              JSON.stringify({ type: "ready", resumeFrom: resumeBytes }),
            );
            speedTracker.current.lastUpdateTime = performance.now();
            speedTracker.current.lastBytes = resumeBytes;
          }
        } else {
          const buffer: ArrayBuffer =
            e.data instanceof Blob
              ? await e.data.arrayBuffer()
              : e.data.buffer || e.data;

          if (buffer.byteLength > 0) {
            receiveBuffer.current.push(buffer);
            setReceivedBytes((prev) => {
              const newTotal = prev + buffer.byteLength;
              const now = performance.now();
              const timeDiff = now - speedTracker.current.lastUpdateTime;
              if (timeDiff > 500) {
                setTransferSpeed(
                  `${formatBytes((newTotal - speedTracker.current.lastBytes) / (timeDiff / 1000))}/s`,
                );
                speedTracker.current.lastUpdateTime = now;
                speedTracker.current.lastBytes = newTotal;
              }
              return newTotal;
            });
          }
        }
      };

      receiveChannel.onclose = () => {
        // Only assemble the file if we actually got the whole thing
        if (
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        ) {
          setStatus("Transfer Complete! Preparing your download...");
          const blob = new Blob(receiveBuffer.current);
          setDownloadUrl(URL.createObjectURL(blob));
          setStatus("File ready!");
          if (wsRef.current) wsRef.current.close();
          expectedFileName.current = ""; // Clear so next file starts fresh
        }
      };
    };
  };

  const progressPercentage =
    fileSize > 0
      ? Math.min(100, Math.round((receivedBytes / fileSize) * 100))
      : 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white p-6">
      <div
        className={`max-w-md w-full rounded-xl shadow-2xl p-8 space-y-6 text-center border transition-colors duration-500 ${isDisconnected ? "bg-red-900/20 border-red-500" : "bg-gray-800 border-gray-700"}`}
      >
        <h1 className="text-4xl font-bold tracking-tight text-blue-400">
          PeerDrop
        </h1>

        {appError && (
          <div className="w-full bg-red-900/40 border border-red-500 rounded-lg p-4 text-left animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center space-x-2 text-red-400 font-bold mb-1">
              <span>⚠️ {appError.title}</span>
            </div>
            <p className="text-sm text-red-200">
              <span className="font-semibold text-white">Solution: </span>
              {appError.solution}
            </p>
            <button
              onClick={() => setAppError(null)}
              className="mt-3 text-xs bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {!downloadUrl && (
          <div className="space-y-4 pt-4">
            <input
              type="text"
              maxLength={4}
              placeholder="0000"
              className="w-full bg-gray-900 border border-gray-700 text-white text-center text-3xl tracking-[0.5em] rounded-lg py-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.replace(/\D/g, ""))}
            />
            <button
              onClick={() => connectAndJoin()}
              disabled={roomId.length !== 4}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 py-3 rounded-lg font-semibold text-lg"
            >
              {isDisconnected ? "Resume Connection" : "Connect"}
            </button>
          </div>
        )}

        {fileSize > 0 && !downloadUrl && (
          <div className="w-full space-y-3 pt-4">
            <div className="flex justify-between text-xs font-medium text-gray-300">
              <span className="truncate max-w-[60%]">{fileName}</span>
              <span className="text-blue-400">{progressPercentage}%</span>
            </div>
            <div className="w-full bg-gray-900 rounded-full h-3 overflow-hidden border border-gray-700">
              <div
                className={`${isDisconnected ? "bg-gray-500" : "bg-blue-500"} h-full rounded-full transition-all duration-300 relative`}
                style={{ width: `${progressPercentage}%` }}
              >
                <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/20 rounded-t-full"></div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 font-mono">
              <span>
                {formatBytes(receivedBytes)} / {formatBytes(fileSize)}
              </span>
              {!isDisconnected && (
                <span className="text-green-400">{transferSpeed}</span>
              )}
            </div>
          </div>
        )}

        <div className="pt-4">
          <p className="text-sm text-yellow-400 font-mono">{status}</p>
        </div>

        {downloadUrl && (
          <div className="pt-4 animate-bounce">
            <a
              href={downloadUrl}
              download={fileName}
              className="inline-block bg-green-500 hover:bg-green-400 text-gray-900 font-bold py-3 px-8 rounded-full"
            >
              ⬇️ Save {fileName}
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
