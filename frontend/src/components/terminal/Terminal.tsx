"use client";

import React, { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { Terminal as TerminalIcon, RefreshCw, Copy, Check, Loader2 } from "lucide-react";

interface TerminalProps {
  socket: Socket | null;
  replId: string;
}

function decodeData(buf: any): string {
  if (typeof buf === "string") return buf;
  if (!buf) return "";

  if (buf instanceof ArrayBuffer) {
    try {
      return new TextDecoder("utf-8").decode(new Uint8Array(buf));
    } catch {
      return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
    }
  }

  if (buf instanceof Uint8Array || ArrayBuffer.isView(buf)) {
    try {
      return new TextDecoder("utf-8").decode(buf);
    } catch {
      return String.fromCharCode.apply(null, Array.from(buf as any));
    }
  }

  if (typeof buf === "object") {
    if (buf.data instanceof ArrayBuffer) return decodeData(buf.data);
    if (buf.data instanceof Uint8Array || ArrayBuffer.isView(buf.data)) return decodeData(buf.data);
    if (Array.isArray(buf.data)) {
      try {
        return new TextDecoder("utf-8").decode(new Uint8Array(buf.data));
      } catch {
        return String.fromCharCode.apply(null, buf.data);
      }
    }
    if (typeof (buf as any).toString === "function" && buf.constructor?.name === "Buffer") {
      return buf.toString("utf-8");
    }
  }

  return "";
}

export default function Terminal({ socket, replId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"connecting" | "active" | "disconnected">("connecting");

  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;

    const initTerm = async () => {
      if (!terminalRef.current) return;

      const { Terminal: XTerm } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");
      // @ts-ignore
      await import("xterm/css/xterm.css");

      term = new XTerm({
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.25,
        theme: {
          background: "#0B0D11",
          foreground: "#E2E8F0",
          cursor: "#E73F1E",
          selectionBackground: "#334155",
          black: "#1E293B",
          red: "#EF4444",
          green: "#10B981",
          yellow: "#F59E0B",
          blue: "#3B82F6",
          magenta: "#8B5CF6",
          cyan: "#06B6D4",
          white: "#F8FAFC",
        },
        convertEol: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      termInstanceRef.current = term;
      fitAddonRef.current = fitAddon;

      term.writeln("\x1b[38;2;231;63;30m=== Vessel Docker Sandbox Terminal ===\x1b[0m");
      term.writeln("\x1b[90mConnected via WebSocket to isolated container bash PTY.\x1b[0m\n");

      // Handle user keystrokes
      term.onData((data: string) => {
        if (socket && socket.connected) {
          socket.emit("terminalData", { data, terminalId: 0 });
        }
      });

      // Handle resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (socket && socket.connected) {
          socket.emit("terminalResize", { cols, rows });
        }
      });
    };

    initTerm();

    const handleWindowResize = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener("resize", handleWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && terminalRef.current) {
      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {}
      });
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver?.disconnect();
      term?.dispose();
    };
  }, []);

  // Wire up socket events
  useEffect(() => {
    if (!socket) {
      setStatus("connecting");
      return;
    }

    const onConnect = () => {
      setStatus("active");
      socket.emit("requestTerminal");
      if (fitAddonRef.current && termInstanceRef.current) {
        fitAddonRef.current.fit();
        socket.emit("terminalResize", {
          cols: termInstanceRef.current.cols,
          rows: termInstanceRef.current.rows,
        });
      }
    };

    const onDisconnect = () => {
      setStatus("disconnected");
    };

    const onTerminalData = (payload: any) => {
      const decoded = decodeData(payload?.data);
      if (decoded && termInstanceRef.current) {
        termInstanceRef.current.write(decoded);
      }
    };

    if (socket.connected) {
      onConnect();
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("terminal", onTerminalData);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("terminal", onTerminalData);
    };
  }, [socket]);

  const handleClear = () => {
    termInstanceRef.current?.clear();
  };

  const handleCopy = () => {
    if (termInstanceRef.current) {
      const selection = termInstanceRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0D11] border-t border-[#232936]">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#12151B] border-b border-[#232936] text-xs shrink-0 select-none">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-[#E73F1E]" />
          <span className="font-mono text-slate-300 font-semibold">Terminal</span>
          <span
            className={`w-2 h-2 rounded-full ${
              status === "active"
                ? "bg-emerald-500 animate-pulse"
                : status === "connecting"
                ? "bg-amber-500"
                : "bg-rose-500"
            }`}
            title={`Status: ${status}`}
          />
          <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
            bash &bull; node-pty
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Copy selection"
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClear}
            title="Clear terminal"
            className="px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:text-white rounded hover:bg-[#181C24] transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="flex-1 p-2 overflow-hidden" ref={terminalRef} />
    </div>
  );
}
