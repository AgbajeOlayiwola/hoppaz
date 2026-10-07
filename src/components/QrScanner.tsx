"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, X } from "lucide-react";

/** Local-only QR reader. Frames stay on-device; only the decoded short token is sent. */
export default function QrScanner({ onRead, onClose }: { onRead: (value:string)=>void; onClose:()=>void }) {
  const video=useRef<HTMLVideoElement>(null);const canvas=useRef<HTMLCanvasElement>(null);const read=useRef(onRead);read.current=onRead;const [error,setError]=useState("");
  useEffect(()=>{let stream:MediaStream|null=null;let frame=0;let stopped=false;
    const start=async()=>{try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});if(stopped)return;const el=video.current;if(!el)return;el.srcObject=stream;await el.play();const tick=()=>{if(stopped)return;const v=video.current,c=canvas.current;if(v&&c&&v.readyState>=2){c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext("2d",{willReadFrequently:true});if(ctx){ctx.drawImage(v,0,0,c.width,c.height);const img=ctx.getImageData(0,0,c.width,c.height);const hit=jsQR(img.data,img.width,img.height,{inversionAttempts:"attemptBoth"});if(hit?.data){stopped=true;read.current(hit.data);return;}}}frame=requestAnimationFrame(tick)};tick();}catch{setError("Camera access failed. Allow camera use or type the code instead.")}};
    void start();return()=>{stopped=true;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop())};
  },[]);
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/90 p-4" onClick={onClose}><div className="card w-full max-w-sm" onClick={e=>e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-2 font-display font-black"><Camera size={16} className="text-orange"/> SCAN DROP QR</p><button onClick={onClose} aria-label="Close scanner"><X size={16}/></button></div><video ref={video} playsInline muted className="aspect-square w-full rounded bg-ink"/><canvas ref={canvas} className="hidden"/><p className="hint mt-2">Hold the QR in the frame. The scan is processed on this device.</p>{error&&<p role="alert" className="mt-2 text-xs text-orange">{error}</p>}</div></div>;
}
