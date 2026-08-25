/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  X, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Settings2, 
  Loader2, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Zap,
  Info,
  Layers,
  Sparkles,
  RefreshCw,
  Clock
} from 'lucide-react';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// Declare globals for browser-loaded script libraries
declare global {
  interface Window {
    PDFLib: any;
    pdfjsLib: any;
  }
}

interface FileStatus {
  file: File;
  id: string;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  compressedBlob?: Blob;
  error?: string;
  originalSize: number;
  compressedSize?: number;
  pages?: number;
}

// Utility to get PDF tools safely
const getPDFLib = () => {
  if (typeof window !== 'undefined' && window.PDFLib) {
    return window.PDFLib;
  }
  return null;
};

const getPdfjsLib = () => {
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    return lib;
  }
  return null;
};

export default function App() {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [compressionMode, setCompressionMode] = useState<'flatten' | 'structural'>('flatten');
  const [dpi, setDpi] = useState<number>(120); // Scale factor DPI: 72, 100, 120, 150, 200
  const [quality, setQuality] = useState<number>(0.65); // 0.1 to 1.0 Jpeg Quality
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll for the CDN engine scripts to load
  useEffect(() => {
    const checkEngines = () => {
      if (window.PDFLib && window.pdfjsLib) {
        setEngineLoaded(true);
      } else {
        setTimeout(checkEngines, 300);
      }
    };
    checkEngines();
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files) as File[];
    const pdfFiles = droppedFiles.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    addFiles(pdfFiles);
  }, []);

  const addFiles = async (newFiles: File[]) => {
    const pdfjsLib = getPdfjsLib();
    const newFileStatuses: FileStatus[] = [];

    for (const file of newFiles) {
      let pageCount = undefined;
      
      // Try resolving page count immediately
      if (pdfjsLib) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdfDoc = await loadingTask.promise;
          pageCount = pdfDoc.numPages;
        } catch (e) {
          console.warn("Could not calculate page count during load: ", e);
        }
      }

      newFileStatuses.push({
        file,
        id: Math.random().toString(36).substring(7),
        progress: 0,
        status: 'pending',
        originalSize: file.size,
        pages: pageCount
      });
    }

    setFiles(prev => [...prev, ...newFileStatuses]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files) as File[];
      const pdfFiles = selectedFiles.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
      addFiles(pdfFiles);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
  };

  const processFiles = async () => {
    const PDFLib = getPDFLib();
    const pdfjsLib = getPdfjsLib();

    if (!PDFLib || !pdfjsLib) {
      alert("PDF processing modules are still loading. Please wait a moment.");
      return;
    }

    setIsProcessing(true);

    for (let i = 0; i < files.length; i++) {
      const currentFile = files[i];
      if (currentFile.status === 'completed') continue;

      try {
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'processing', progress: 5 } : f));
        
        const fileBytes = await currentFile.file.arrayBuffer();

        if (compressionMode === 'structural') {
          // Mode: Structural clean-up (metadata scrubbing, object stream optimization)
          const srcDoc = await PDFLib.PDFDocument.load(fileBytes);
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 30 } : f));
          
          const destDoc = await PDFLib.PDFDocument.create();
          const pageCount = srcDoc.getPageCount();
          const pageIndices = Array.from({ length: pageCount }, (_, idx) => idx);
          
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 50, pages: pageCount } : f));
          
          const copiedPages = await destDoc.copyPages(srcDoc, pageIndices);
          for (const page of copiedPages) {
            destDoc.addPage(page);
          }
          
          setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: 80 } : f));
          const compressedBytes = await destDoc.save({ useObjectStreams: true });
          const compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });

          setFiles(prev => prev.map((f, idx) => idx === i ? { 
            ...f, 
            status: 'completed', 
            progress: 100, 
            compressedBlob, 
            compressedSize: compressedBlob.size,
            pages: pageCount
          } : f));
        } else {
          // Mode: Flattening & resizing to image-layers
          const loadingTask = pdfjsLib.getDocument({ data: fileBytes });
          const pdfDoc = await loadingTask.promise;
          const pageCount = pdfDoc.numPages;

          const compressedPdf = await PDFLib.PDFDocument.create();
          const scaleFactor = dpi / 72;

          for (let p = 1; p <= pageCount; p++) {
            const page = await pdfDoc.getPage(p);
            const viewport = page.getViewport({ scale: scaleFactor });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              throw new Error("Could not initialize 2D render context.");
            }

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Render PDF page to canvas
            await page.render({
              canvasContext: ctx,
              viewport: viewport
            }).promise;

            // Compress to JPEG Blob
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const imgRes = await fetch(dataUrl);
            const imgBytes = await imgRes.arrayBuffer();

            // Embed JPEG inside output PDF
            const embeddedImg = await compressedPdf.embedJpg(imgBytes);
            const newDocPage = compressedPdf.addPage([viewport.width, viewport.height]);
            newDocPage.drawImage(embeddedImg, {
              x: 0,
              y: 0,
              width: viewport.width,
              height: viewport.height,
            });

            // Update item progress
            const currentProgress = Math.round(10 + (p / pageCount) * 80);
            setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, progress: currentProgress, pages: pageCount } : f));
          }

          const compressedBytes = await compressedPdf.save({ useObjectStreams: true });
          const compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });

          setFiles(prev => prev.map((f, idx) => idx === i ? { 
            ...f, 
            status: 'completed', 
            progress: 100, 
            compressedBlob, 
            compressedSize: compressedBlob.size,
            pages: pageCount
          } : f));
        }
      } catch (error: any) {
        console.error('Compression error:', error);
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: 'error', error: error.message || 'Failed to compress PDF' } : f));
      }
    }

    setIsProcessing(false);
  };

  const handleDownloadSingle = (fileStatus: FileStatus) => {
    if (fileStatus.compressedBlob) {
      const url = URL.createObjectURL(fileStatus.compressedBlob);
      const link = document.createElement('a');
      link.href = url;
      // Preserve exactly same file name!
      link.download = fileStatus.file.name;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    files.forEach(f => {
      if (f.compressedBlob) {
        // Preserve exactly same original file name!
        zip.file(f.file.name, f.compressedBlob);
      }
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'compressed_pdfs_archive.zip';
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Compute overall statistics
  const completedFiles = files.filter(f => f.status === 'completed');
  const originalTotalSize = completedFiles.reduce((sum, f) => sum + f.originalSize, 0);
  const compressedTotalSize = completedFiles.reduce((sum, f) => sum + (f.compressedSize || 0), 0);
  const totalSavingsRatio = originalTotalSize > 0 ? (1 - (compressedTotalSize / originalTotalSize)) : 0;

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans selection:bg-emerald-100 pb-16">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-xs">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="./logo.png" 
              alt="ITG Logo" 
              className="h-10 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
            <div className="border-l border-stone-200 pl-3">
              <h1 className="text-lg font-bold tracking-tight">ITG Batch PDF Compressor</h1>
              <p className="text-[10px] text-stone-500 font-medium uppercase tracking-wider">Professional PDF Optimization</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {!engineLoaded && (
              <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-3 py-1.5 rounded-full border border-amber-200 flex items-center gap-1.5 animate-pulse">
                <RefreshCw size={12} className="animate-spin" /> Load Engines
              </span>
            )}
            {engineLoaded && (
              <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-1.5">
                <Sparkles size={12} /> Local Processing Engine Active
              </span>
            )}
            {files.length > 0 && (
              <button 
                onClick={clearAll}
                className="text-xs font-semibold text-stone-500 hover:text-red-600 transition-colors flex items-center gap-2 bg-stone-50 hover:bg-red-50 px-3 py-2 rounded-xl border border-stone-200"
              >
                <Trash2 size={13} />
                Clear All
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        
        {/* Banner with notice */}
        <div className="bg-emerald-800 text-white rounded-3xl p-8 mb-8 relative overflow-hidden shadow-md">
          <div className="absolute right-0 bottom-0 opacity-15 transform translate-y-6 translate-x-12 scale-125">
            <Layers size={240} />
          </div>
          <div className="relative z-10 max-w-xl">
            <span className="bg-emerald-600/60 text-emerald-100 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full uppercase border border-white/10">Browser-Based Security</span>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-3 tracking-tight">Offline Batch PDF Optimizer</h2>
            <p className="text-emerald-50/90 text-sm mt-2 leading-relaxed">
              Compress, resize, and streamline your files dynamically. Your confidential PDF data never leaves your computer — all operations occur securely right inside your web browser.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Settings Side Panel */}
          <aside className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-3xl p-6 shadow-xs border border-stone-200">
              <div className="flex items-center gap-2 mb-5">
                <Settings2 size={18} className="text-emerald-600" />
                <h2 className="font-bold text-base text-stone-800">Optimization Settings</h2>
              </div>
              
              <div className="space-y-5">
                {/* Mode Selectors */}
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Compression Strategy</label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Flattening Mode */}
                    <button
                      type="button"
                      onClick={() => setCompressionMode('flatten')}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all relative flex flex-col gap-1 cursor-pointer",
                        compressionMode === 'flatten' 
                          ? "border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-600/20" 
                          : "border-stone-200 hover:border-stone-300 hover:bg-stone-50/50"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-stone-800">High Visual Optimization</span>
                        <Layers size={16} className={compressionMode === 'flatten' ? "text-emerald-600" : "text-stone-400"} />
                      </div>
                      <p className="text-xs text-stone-500 leading-normal">
                        Renders pages to scale-optimized layers and recompresses. Highly recommended for scanned pages, contracts and images.
                      </p>
                    </button>

                    {/* Structural Mode */}
                    <button
                      type="button"
                      onClick={() => setCompressionMode('structural')}
                      className={cn(
                        "p-4 rounded-2xl border text-left transition-all relative flex flex-col gap-1 cursor-pointer",
                        compressionMode === 'structural' 
                          ? "border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-600/20" 
                          : "border-stone-200 hover:border-stone-300 hover:bg-stone-50/50"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-stone-800">Structural Cleanup (Vectors)</span>
                        <Zap size={16} className={compressionMode === 'structural' ? "text-emerald-600" : "text-stone-400"} />
                      </div>
                      <p className="text-xs text-stone-500 leading-normal">
                        Scrubs duplicate embedded fonts, edit history and redundant metadata. Preserves vector fidelity and selectable/copyable text.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Adjustables */}
                <AnimatePresence>
                  {compressionMode === 'flatten' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden space-y-4 pt-1"
                    >
                      {/* Resolution Slider */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-xs font-semibold text-stone-600">Max Resolution (DPI)</label>
                          <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                            {dpi} DPI
                          </span>
                        </div>
                        <input 
                          type="range" 
                          min="72" 
                          max="200" 
                          step="10" 
                          value={dpi}
                          onChange={(e) => setDpi(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                        />
                        <div className="flex justify-between text-[10px] text-stone-400 mt-1 font-semibold">
                          <span>72 (DRAFT)</span>
                          <span>120 (STANDARD)</span>
                          <span>200 (HD)</span>
                        </div>
                      </div>

                      {/* Quality Slider */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-xs font-semibold text-stone-600">Visual Quality Preset</label>
                          <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                            {Math.round(quality * 100)}%
                          </span>
                        </div>
                        <input 
                          type="range" 
                          min="0.2" 
                          max="1.0" 
                          step="0.05" 
                          value={quality}
                          onChange={(e) => setQuality(parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                        />
                        <div className="flex justify-between text-[10px] text-stone-400 mt-1 font-semibold">
                          <span>AGGRESSIVE SHRUNK</span>
                          <span>BALANCED QUALITY</span>
                          <span>ULTRA PRISTINE</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Trigger */}
                <div className="pt-2">
                  <button
                    onClick={processFiles}
                    disabled={files.length === 0 || isProcessing || !engineLoaded}
                    className={cn(
                      "w-full py-3.5 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-700/10 cursor-pointer",
                      files.length === 0 || isProcessing || !engineLoaded
                        ? "bg-stone-300 text-stone-500 shadow-none cursor-not-allowed" 
                        : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]"
                    )}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        Optimizing PDF Docs...
                      </>
                    ) : (
                      <>
                        <Zap size={18} />
                        Start PDF Compression
                      </>
                    )}
                  </button>
                  
                  {files.length === 0 && (
                    <p className="text-[10px] text-stone-400 text-center mt-2 font-medium">Add PDF files to begin processing</p>
                  )}
                </div>
              </div>
            </div>

            {/* Total Compression Stats Panel */}
            {completedFiles.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-800 text-white rounded-3xl p-6 shadow-md relative overflow-hidden"
              >
                <div className="relative z-10 flex flex-col h-full justify-between">
                  <div>
                    <h3 className="font-bold text-base mb-1">Batch Compression Summary</h3>
                    <p className="text-emerald-200 text-xs mb-4">You have successfully reduced the storage requirements of your items.</p>
                    
                    <div className="grid grid-cols-2 gap-4 bg-emerald-900/40 p-3 rounded-2xl border border-white/5 mb-5">
                      <div>
                        <span className="text-[10px] text-emerald-300 uppercase tracking-wider font-semibold">Original Size</span>
                        <div className="font-mono text-base font-bold text-stone-100">{formatSize(originalTotalSize)}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-300 uppercase tracking-wider font-semibold">Compressed Size</span>
                        <div className="font-mono text-base font-bold text-emerald-200">{formatSize(compressedTotalSize)}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mb-5 bg-emerald-600/20 px-4 py-2 rounded-xl">
                      <span className="text-xs font-semibold text-emerald-200">Total Storage Saved:</span>
                      <span className="text-sm font-black text-white bg-emerald-500 px-2.5 py-1 rounded-lg">
                        -{Math.round(totalSavingsRatio * 100)}% ({formatSize(originalTotalSize - compressedTotalSize)})
                      </span>
                    </div>
                  </div>

                  <button 
                    onClick={downloadAll}
                    className="w-full bg-white text-emerald-800 py-3 rounded-xl font-bold hover:bg-emerald-50 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm text-sm"
                  >
                    <Download size={16} />
                    Download All as ZIP
                  </button>
                </div>
              </motion.div>
            )}
          </aside>

          {/* Core App Main Content Workspace */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Native Drag & Drop Upload Zone */}
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className="bg-white border-2 border-dashed border-stone-200 rounded-[2rem] p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/20 transition-all group shadow-2xs"
            >
              <input 
                type="file" 
                multiple 
                accept="application/pdf" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <div className="w-16 h-16 bg-stone-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-115 transition-transform group-hover:bg-emerald-50 border border-stone-100">
                <Upload className="text-stone-400 group-hover:text-emerald-600 transition-colors" size={24} />
              </div>
              <h3 className="text-base font-bold text-stone-800 mb-1">Upload PDF Files</h3>
              <p className="text-stone-500 text-xs max-w-xs mx-auto mb-2 leading-relaxed">
                Drag and drop your PDF documents here, or click to browse files locally.
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-stone-400 bg-stone-50 px-3 py-1 rounded-full border border-stone-100 font-semibold">
                <Info size={11} /> Multi-file support active
              </div>
            </div>

            {/* List Header and Counter */}
            <div className="flex items-center justify-between px-1">
              <h3 className="font-bold text-sm text-stone-700 flex items-center gap-2">
                Processed Queue 
                <span className="text-xs bg-stone-200 text-stone-700 font-mono px-2 py-0.5 rounded-full font-bold">{files.length}</span>
              </h3>
              
              {files.length > 0 && (
                <div className="text-[11px] text-stone-500 flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 inline-block"></span>
                    {files.filter(f => f.status === 'pending').length} Pending
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    {files.filter(f => f.status === 'completed').length} Completed
                  </span>
                </div>
              )}
            </div>

            {/* Document Queue Layout */}
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {files.map((fileStatus) => (
                  <motion.div
                    key={fileStatus.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl p-4 border border-stone-200/90 flex items-center gap-4 group hover:border-stone-300 transition-colors shadow-2xs"
                  >
                    {/* PDF Document Icon Block */}
                    <div className="w-11 h-11 bg-red-50 text-red-600 rounded-xl flex flex-col items-center justify-center border border-red-100 shrink-0">
                      <FileText size={18} />
                      <span className="text-[8px] font-black tracking-wider uppercase mt-0.5">PDF</span>
                    </div>
                    
                    {/* Detailed info content item */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <h4 className="font-bold text-xs text-stone-800 truncate pr-4" title={fileStatus.file.name}>
                          {fileStatus.file.name}
                        </h4>
                        <span className="text-[10px] font-mono font-semibold text-stone-400">
                          {formatSize(fileStatus.originalSize)}
                        </span>
                      </div>
                      
                      {/* Interactive Progress Indicator or details */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${fileStatus.progress}%` }}
                            className={cn(
                              "h-full transition-all duration-300",
                              fileStatus.status === 'error' ? "bg-red-500" : 
                              fileStatus.status === 'completed' ? "bg-emerald-500" : "bg-emerald-500/80 animate-pulse"
                            )}
                          />
                        </div>
                        <span className="text-[9px] font-bold text-stone-500 w-8 text-right font-mono">
                          {Math.round(fileStatus.progress)}%
                        </span>
                      </div>

                      {/* Dynamic secondary metadata */}
                      <div className="flex items-center justify-between mt-1.5 text-[9px] text-stone-400">
                        <span className="flex items-center gap-1 font-semibold">
                          <Layers size={10} />
                          {fileStatus.pages !== undefined ? `${fileStatus.pages} pages` : "analyzing..."}
                        </span>
                        
                        {fileStatus.status === 'processing' && (
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <RefreshCw size={8} className="animate-spin" /> reconstructing page variables
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Output & Actions block */}
                    <div className="flex items-center gap-3 pl-2.5">
                      {fileStatus.status === 'completed' && (
                        <div className="flex items-center gap-2">
                          <div className="text-right shrink-0">
                            {fileStatus.compressedSize !== undefined && fileStatus.compressedSize < fileStatus.originalSize ? (
                              <>
                                <div className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 justify-end font-sans">
                                  <CheckCircle2 size={11} />
                                  SAVED {Math.round((1 - (fileStatus.compressedSize / fileStatus.originalSize)) * 100)}%
                                </div>
                                <div className="text-[9px] font-mono text-stone-400">
                                  {formatSize(fileStatus.compressedSize)}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-[9px] font-semibold text-stone-500 flex items-center gap-1 justify-end font-sans">
                                  ALREADY OPTIMAL
                                </div>
                                <div className="text-[9px] font-mono text-stone-400">
                                  {formatSize(fileStatus.originalSize)}
                                </div>
                              </>
                            )}
                          </div>
                          
                          <button
                            onClick={() => handleDownloadSingle(fileStatus)}
                            className="p-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                            title="Download Optimized Version"
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      )}
                      
                      {fileStatus.status === 'error' && (
                        <div className="text-red-500 flex items-center gap-1 text-[10px] font-bold bg-red-50 pr-2 pl-1.5 py-1 rounded-lg border border-red-100" title={fileStatus.error}>
                          <AlertCircle size={14} /> Err
                        </div>
                      )}

                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(fileStatus.id);
                        }}
                        disabled={isProcessing}
                        className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {files.length === 0 && (
                <div className="py-16 text-center bg-white rounded-[2rem] border border-stone-200/80 shadow-3xs flex flex-col items-center justify-center">
                  <p className="text-stone-400 text-sm italic">Queue is currently empty.</p>
                  <p className="text-stone-300 text-xs mt-1">Add your PDF files using the box above.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-stone-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-stone-400 text-xs">
          <p>© 2026 ITG Batch PDF Compressor. Secure execution framework.</p>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1"><Clock size={11} /> 100% Client-Side Engine</span>
            <a href="#" className="hover:text-stone-600 transition-colors">Privacy</a>
            <a href="#" className="hover:text-stone-600 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
