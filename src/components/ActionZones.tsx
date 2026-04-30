"use client";

import { useState, useEffect } from "react";
import { UploadCloud, FolderUp, KeyRound, ArrowRight, ShieldCheck, HardDriveDownload, XCircle, Loader2, Copy, Check, Link, Smartphone, Monitor } from "lucide-react";
import QRCode from "react-qr-code";
import { usePeerDrop } from "../hooks/usePeerDrop";
import { zipFolder } from "../utils/zip";

const PEERDROP_TIPS = [
  "End-to-End Encrypted. Your files are never stored on our servers.",
  "Unlimited File Size. Transfer 50GB+ folders with zero limits.",
  "True Peer-to-Peer. Data flows directly between devices.",
  "Cross-Platform. Share between Windows, Mac, iOS, and Android.",
  "Zero Network Bloat. WebRTC routes over local WiFi automatically.",
  "Resume Anytime. Transfers pause if you lose connection.",
  "Lightning Fast. Zips folders directly on your device."
];

export function ActionZones() {
  const [pin, setPin] = useState("");
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [magicLinkUrl, setMagicLinkUrl] = useState("");
  
  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  
  const { 
    appState, displayCode, statusMsg, metrics, 
    initiateSend, initiateReceive, resetState 
  } = usePeerDrop();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code && code.length === 8) {
        setPin(code);
        initiateReceive(code);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && displayCode) {
      setMagicLinkUrl(`${window.location.origin}/?code=${displayCode}`);
    }
  }, [displayCode]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isZipping || appState === "transferring") {
      interval = setInterval(() => {
        setTipIndex((prev) => (prev + 1) % PEERDROP_TIPS.length);
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [isZipping, appState]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (appState === "idle" && !isZipping) {
        setIsGlobalDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 || e.clientY === 0) {
        setIsGlobalDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsGlobalDragging(false);

      if (appState !== "idle" || isZipping) return;

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const item = e.dataTransfer.items[0];
        if (item && item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            alert("To upload an entire folder with compression, please use the 'Select Folder' button.");
            return;
          }
        }
        initiateSend(e.dataTransfer.files[0]);
      }
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [appState, isZipping, initiateSend]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) initiateSend(e.target.files[0]);
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsZipping(true);
      setZipProgress(0);
      try {
        const zippedFile = await zipFolder(e.target.files, setZipProgress);
        initiateSend(zippedFile);
      } catch (error) {
        console.error("Failed to zip folder", error);
        alert("Compression failed. The folder might be corrupted or too large.");
      } finally {
        setIsZipping(false);
      }
    }
  };

  const handleJoin = () => {
    if (pin.length === 8) initiateReceive(pin);
  };

  const handleCopyPin = () => {
    navigator.clipboard.writeText(displayCode);
    setCopiedPin(true);
    setTimeout(() => setCopiedPin(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(magicLinkUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const displayPin = pin.length > 4 ? `${pin.slice(0, 4)} - ${pin.slice(4)}` : pin;

  const renderHostCode = () => {
    if (!displayCode || displayCode.length !== 8) {
      return <span className="animate-pulse text-gray-400">•••• <span className="opacity-30 mx-1 sm:mx-2">-</span> ••••</span>;
    }
    return <>{displayCode.slice(0,4)}<span className="opacity-30 mx-1 sm:mx-2">-</span>{displayCode.slice(4,8)}</>;
  };

  // --- UI RENDERERS ---

  return (
    <>
      {isGlobalDragging && (
        <div className="fixed inset-0 z-100 bg-white/60 dark:bg-black/60 backdrop-blur-xl flex flex-col items-center justify-center m-4 rounded-[3rem] border-4 border-dashed border-peer-primary shadow-[0_0_100px_rgba(0,242,255,0.3)] animate-in fade-in zoom-in-95 pointer-events-none">
          <div className="w-32 h-32 rounded-full bg-peer-primary/20 flex items-center justify-center text-peer-primary mb-8 shadow-2xl animate-bounce">
            <UploadCloud className="w-16 h-16" strokeWidth={1.5} />
          </div>
          <h2 className="text-4xl font-display font-medium text-gray-900 dark:text-white tracking-wide">
            Drop file to send
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-4 text-lg">
            PeerDrop will instantly secure and host it.
          </p>
        </div>
      )}

      {appState !== "idle" ? (
        <div className={`w-full ${appState === "hosting" ? "max-w-2xl" : "max-w-md"} mx-auto p-6 sm:p-8 rounded-3xl bg-white dark:bg-white/2 border border-gray-200 dark:border-white/10 shadow-xl dark:shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500 transition-all`}>
          <div className="flex justify-between items-center mb-6 sm:mb-8 border-b border-gray-200 dark:border-white/10 pb-4">
            <span className="text-gray-500 dark:text-gray-400 font-medium">Active Session</span>
            <button onClick={() => { setPin(""); resetState(); }} className="text-gray-400 hover:text-red-500 transition-colors">
              <XCircle size={24} />
            </button>
          </div>

          {appState === "hosting" && (
            <div className="flex flex-col md:flex-row gap-6 sm:gap-8 items-center md:items-start w-full">
              <div className="flex flex-col items-center shrink-0 relative">
                <div className="bg-white p-4 sm:p-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] border border-gray-100 min-h-45 min-w-45 sm:min-h-55 sm:min-w-55 flex items-center justify-center">
                  {!displayCode ? (
                     <Loader2 size={32} className="text-gray-300 animate-spin" />
                  ) : (
                     <QRCode value={magicLinkUrl} size={180} level="H" fgColor="#070B14" className="animate-in zoom-in-95 w-full h-full max-w-35 sm:max-w-45" />
                  )}
                </div>
                <p className="mt-4 sm:mt-5 text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-widest">Scan to Receive</p>
              </div>

              <div className="flex flex-col space-y-5 sm:space-y-6 w-full min-w-0">
                <div className="space-y-2 w-full">
                  <p className="text-gray-500 text-xs uppercase tracking-[0.2em]">Secure Pin</p>
                  <button 
                    onClick={handleCopyPin}
                    disabled={!displayCode}
                    className="group relative flex items-center justify-between w-full bg-gray-50 dark:bg-white/2 border border-gray-200 dark:border-white/5 hover:border-peer-primary/50 dark:hover:border-peer-primary/50 rounded-2xl px-4 sm:px-6 py-3 sm:py-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="text-2xl sm:text-3xl lg:text-4xl font-display font-light tracking-widest sm:tracking-[0.2em] text-gray-900 dark:text-white group-hover:text-peer-primary transition-colors whitespace-nowrap">
                      {renderHostCode()}
                    </div>
                    <div className="text-gray-400 group-hover:text-peer-primary transition-colors bg-white dark:bg-white/5 p-2 rounded-xl shadow-sm border border-gray-100 dark:border-white/5 shrink-0 ml-2 sm:ml-4">
                      {copiedPin ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                    </div>
                  </button>
                </div>

                <div className="space-y-2 w-full">
                  <p className="text-gray-500 text-xs uppercase tracking-[0.2em]">Magic Link</p>
                  <div className="flex items-center w-full min-w-0 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/5 rounded-2xl overflow-hidden focus-within:border-peer-secondary/50 focus-within:ring-1 focus-within:ring-peer-secondary/50 transition-all">
                    <div className="pl-3 sm:pl-4 text-gray-400 shrink-0"><Link size={18} /></div>
                    <input readOnly value={magicLinkUrl} placeholder="Waiting for connection..." className="bg-transparent w-full min-w-0 text-sm text-gray-600 dark:text-gray-300 px-2 sm:px-3 py-3 sm:py-4 outline-none truncate selection:bg-peer-secondary/30 placeholder:text-gray-400" />
                    <div className="pr-2 shrink-0">
                      <button onClick={handleCopyLink} disabled={!displayCode} className="flex items-center justify-center p-2.5 text-gray-500 hover:text-white hover:bg-peer-secondary disabled:hover:bg-transparent disabled:hover:text-gray-500 bg-white dark:bg-white/5 rounded-xl border border-gray-200 dark:border-white/10 transition-all shadow-sm">
                        {copiedLink ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="w-full bg-peer-primary/5 dark:bg-peer-primary/10 border border-peer-primary/20 rounded-xl px-4 sm:px-5 py-3 flex justify-between items-center mt-2 min-w-0">
                  <span className="text-gray-700 dark:text-peer-primary/90 text-sm font-medium truncate pr-4">{metrics.fileName}</span>
                  <ShieldCheck size={18} className="text-peer-primary shrink-0" />
                </div>
                <p className={`text-xs font-medium truncate ${statusMsg.includes("lost") || statusMsg.includes("dropped") ? "text-red-400" : "text-peer-primary/80 animate-pulse"}`}>{statusMsg}</p>
              </div>
            </div>
          )}

          {appState === "joining" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-12 h-12 text-peer-secondary animate-spin" />
              <p className="text-peer-secondary tracking-wide text-center">{statusMsg}</p>
            </div>
          )}

          {appState === "paused" && (
            <div className="w-full space-y-6 min-w-0 animate-in fade-in">
              <div className="flex justify-between items-end">
                <div className="flex flex-col min-w-0 pr-4">
                  <span className="text-yellow-500 text-xs uppercase tracking-widest mb-2">Transfer Paused</span>
                  <span className="text-gray-900 dark:text-gray-200 font-medium truncate">{metrics.fileName}</span>
                </div>
                <span className="text-2xl sm:text-3xl font-display font-light text-yellow-500 shrink-0">{metrics.progress}%</span>
              </div>
              
              <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div style={{ width: `${metrics.progress}%` }} className="absolute top-0 left-0 h-full bg-yellow-500 transition-all duration-300 ease-out" />
              </div>

              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5 sm:p-6 mt-6 space-y-4 shadow-inner">
                <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium text-center">
                  Connection dropped. Ask the sender to re-select the file to get a new PIN.
                </p>
                
                <input
                  type="text"
                  maxLength={11}
                  placeholder="0000 - 4472"
                  value={displayPin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="w-full bg-white dark:bg-black/20 border border-yellow-500/30 text-gray-900 dark:text-white text-center text-2xl sm:text-3xl tracking-widest sm:tracking-[0.2em] rounded-xl py-4 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all font-display"
                />
                
                <button
                  onClick={handleJoin}
                  disabled={pin.length !== 8}
                  className="w-full group flex items-center justify-center gap-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-200 dark:disabled:bg-gray-800 text-white py-4 rounded-xl font-medium tracking-wide transition-all shadow-[0_8px_20px_rgba(234,179,8,0.2)] disabled:shadow-none"
                >
                  Resume Transfer
                </button>
              </div>
              
              <p className="text-xs font-medium text-center truncate text-red-400 animate-pulse">{statusMsg}</p>
            </div>
          )}

          {appState === "error" && (
            <div className="flex flex-col items-center justify-center py-10 space-y-6 animate-in zoom-in-95">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-2 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                <XCircle className="w-10 h-10" strokeWidth={1.5} />
              </div>
              <div className="text-center space-y-2 px-4">
                <h3 className="text-lg sm:text-xl font-medium text-gray-900 dark:text-white">Transfer Rejected</h3>
                <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 max-w-sm">{statusMsg}</p>
              </div>
              <button
                onClick={() => { setPin(""); resetState(); }}
                className="px-8 py-3 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-full transition-colors font-medium text-gray-700 dark:text-gray-300"
              >
                Start Over
              </button>
            </div>
          )}

          {appState === "transferring" && (
            <div className="w-full space-y-6 min-w-0">
              <div className="flex justify-between items-end">
                <div className="flex flex-col min-w-0 pr-4">
                  {/* THE GRAMMAR FIX: Dynamically checks role using displayCode */}
                  <span className="text-gray-500 text-xs uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    {metrics.peerDeviceName.includes("iPhone") || metrics.peerDeviceName.includes("Android") ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                    {metrics.peerDeviceName !== "Unknown Device" 
                      ? (displayCode ? `Transferring to ${metrics.peerDeviceName}` : `Receiving from ${metrics.peerDeviceName}`) 
                      : (displayCode ? "Transferring File" : "Receiving File")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-200 font-medium truncate">{metrics.fileName}</span>
                </div>
                <span className="text-2xl sm:text-3xl font-display font-light text-gray-900 dark:text-white shrink-0">{metrics.progress}%</span>
              </div>
              <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="absolute top-0 left-0 h-full bg-peer-secondary transition-all duration-300 ease-out"
                  style={{ width: `${metrics.progress}%` }}
                />
              </div>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs font-mono text-gray-500">
                <span>{metrics.speed}</span>
                <span className="flex items-center gap-1.5 text-peer-primary bg-peer-primary/10 px-2 py-1 rounded font-sans shrink-0">
                  <ShieldCheck size={12} /> Encrypted
                </span>
              </div>
              
              <div className="h-12 flex items-center justify-center overflow-hidden pt-4 border-t border-gray-200 dark:border-white/5">
                <p key={tipIndex} className="text-sm text-center text-gray-500 dark:text-gray-400 animate-in fade-in slide-in-from-bottom-2 duration-500 px-2 sm:px-4">
                  {PEERDROP_TIPS[tipIndex]}
                </p>
              </div>
            </div>
          )}

          {appState === "complete" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-peer-primary/10 flex items-center justify-center text-peer-primary mb-2 shadow-[0_0_30px_rgba(0,242,255,0.2)]">
                <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10" strokeWidth={1.5} />
              </div>
              <p className="text-gray-900 dark:text-gray-300 text-center font-medium px-4">{statusMsg}</p>
              {metrics.downloadUrl && (
                <a
                  href={metrics.downloadUrl}
                  download={metrics.fileName}
                  className="flex items-center gap-3 bg-peer-secondary hover:bg-blue-600 text-white font-medium py-3 sm:py-4 px-8 sm:px-10 rounded-full transition-all shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_25px_rgba(0,122,255,0.5)] hover:-translate-y-1 text-sm sm:text-base"
                >
                  <HardDriveDownload size={20} /> Save to Device
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-5xl mx-auto animate-in fade-in duration-500">
          
          <div className="flex flex-col justify-between h-full min-h-80 sm:min-h-90 p-6 sm:p-8 rounded-3xl bg-white dark:bg-white/2 border border-gray-200 dark:border-white/10 shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all relative">
            <div>
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-peer-secondary/10 flex items-center justify-center text-peer-secondary mb-4 sm:mb-6">
                <KeyRound className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl sm:text-2xl font-display font-medium text-gray-900 dark:text-white mb-2">Receive File</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 sm:mb-8">
                Enter the 8-digit secure PIN generated by the sender.
              </p>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                maxLength={11}
                placeholder="0000 - 0000"
                value={displayPin}
                onChange={(e) => {
                  const rawDigits = e.target.value.replace(/\D/g, "").slice(0, 8);
                  setPin(rawDigits);
                }}
                className="w-full bg-gray-50 dark:bg-black/20 border border-gray-300 dark:border-white/10 text-gray-900 dark:text-white text-center text-3xl sm:text-4xl tracking-widest sm:tracking-[0.2em] placeholder:text-gray-400/60 dark:placeholder:text-gray-600/60 rounded-2xl py-4 sm:py-6 focus:outline-none focus:border-peer-secondary focus:ring-1 focus:ring-peer-secondary transition-all font-display"
              />
              <button
                onClick={handleJoin}
                disabled={pin.length !== 8}
                className="w-full group flex items-center justify-center gap-2 bg-peer-secondary hover:bg-blue-600 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white py-4 rounded-2xl font-medium tracking-wide transition-all shadow-[0_8px_20px_rgba(0,122,255,0.2)] disabled:shadow-none"
              >
                Establish Connection
                <ArrowRight size={18} className="group-disabled:opacity-0 transition-all group-hover:translate-x-1" />
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between h-full min-h-80 sm:min-h-90 p-6 sm:p-8 rounded-3xl bg-white dark:bg-white/2 border border-gray-200 dark:border-white/10 shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all relative overflow-hidden">
            <div className="absolute -top-32 -right-32 w-64 h-64 bg-peer-primary/10 rounded-full blur-[80px] pointer-events-none" />
            
            {isZipping && (
              <div className="absolute inset-0 z-50 bg-white/80 dark:bg-peer-dark/80 backdrop-blur-md flex flex-col items-center justify-center rounded-3xl px-6 sm:px-10 animate-in fade-in">
                <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-peer-primary animate-spin mb-4" />
                <p className="text-gray-900 dark:text-white font-medium mb-3">Compressing Folder</p>
                <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 overflow-hidden relative">
                  <div style={{ width: `${zipProgress}%` }} className="absolute top-0 left-0 h-full bg-linear-to-r from-peer-primary to-blue-500 transition-all duration-200 ease-out" />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">{zipProgress}%</p>
                <div className="h-12 mt-4 sm:mt-6 flex items-center justify-center overflow-hidden text-center">
                  <p key={tipIndex} className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 animate-in fade-in slide-in-from-bottom-2 duration-500 px-2 sm:px-4">
                    {PEERDROP_TIPS[tipIndex]}
                  </p>
                </div>
              </div>
            )}

            <div className="relative z-10">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-peer-primary/10 flex items-center justify-center text-peer-primary mb-4 sm:mb-6">
                <UploadCloud className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl sm:text-2xl font-display font-medium text-gray-900 dark:text-white mb-2">Share with PeerDrop</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 sm:mb-8">Select a single file or an entire folder to securely encrypt and transfer.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 relative z-10">
              <label className="flex-1 group relative flex flex-col items-center justify-center gap-2 sm:gap-3 p-4 sm:p-6 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/5 rounded-2xl cursor-pointer hover:border-peer-primary/50 dark:hover:bg-white/4 transition-all duration-300">
                <UploadCloud className="w-6 h-6 sm:w-7 sm:h-7 text-gray-400 group-hover:text-peer-primary transition-colors" />
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Select File</span>
                <input type="file" className="hidden" onChange={handleFileSelect} />
              </label>
              <label className="flex-1 group relative flex flex-col items-center justify-center gap-2 sm:gap-3 p-4 sm:p-6 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/5 rounded-2xl cursor-pointer hover:border-peer-primary/50 dark:hover:bg-white/4 transition-all duration-300">
                <FolderUp className="w-6 h-6 sm:w-7 sm:h-7 text-gray-400 group-hover:text-peer-primary transition-colors" />
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Select Folder</span>
                <input type="file" className="hidden" onChange={handleFolderSelect} {...{ webkitdirectory: "true", directory: "true" } as any} />
              </label>
            </div>
          </div>
        </div>
      )}
    </>
  );
}