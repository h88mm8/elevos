import { useState, useCallback, useRef, useEffect } from 'react';

type TranscriptionStatus = 'idle' | 'loading-model' | 'transcribing' | 'done' | 'error';

interface TranscriptionResult {
  text: string;
  status: TranscriptionStatus;
  progress: number;
  error?: string;
}

// Singleton for the transcriber pipeline
let transcriber: any = null;
let isLoadingPipeline = false;
let pipelineLoadPromise: Promise<any> | null = null;

async function getTranscriber(onProgress?: (progress: number) => void) {
  if (transcriber) return transcriber;
  
  if (pipelineLoadPromise) {
    return pipelineLoadPromise;
  }
  
  if (isLoadingPipeline) {
    // Wait for existing load
    await new Promise((resolve) => {
      const check = () => {
        if (transcriber) resolve(transcriber);
        else setTimeout(check, 100);
      };
      check();
    });
    return transcriber;
  }
  
  isLoadingPipeline = true;
  
  try {
    const { pipeline } = await import('@huggingface/transformers');
    
    // Check WebGPU support
    let device: 'webgpu' | 'wasm' = 'wasm';
    try {
      const gpu = (navigator as any).gpu;
      if (gpu) {
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          device = 'webgpu';
          console.log('Using WebGPU for transcription');
        }
      }
    } catch (e) {
      console.log('WebGPU not available, falling back to WASM');
    }
    
    pipelineLoadPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      { 
        device,
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' && onProgress) {
            onProgress(Math.round((progress.loaded / progress.total) * 100));
          }
        }
      }
    );
    
    transcriber = await pipelineLoadPromise;
    pipelineLoadPromise = null;
    return transcriber;
  } catch (error) {
    console.error('Failed to load Whisper model:', error);
    isLoadingPipeline = false;
    pipelineLoadPromise = null;
    throw error;
  }
}

export function useAudioTranscription() {
  const [result, setResult] = useState<TranscriptionResult>({
    text: '',
    status: 'idle',
    progress: 0,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const transcribe = useCallback(async (audioUrl: string) => {
    // Abort any existing transcription
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setResult({ text: '', status: 'loading-model', progress: 0 });

    try {
      // Load the model with progress tracking
      const pipe = await getTranscriber((progress) => {
        setResult(prev => ({ ...prev, progress }));
      });

      if (abortControllerRef.current.signal.aborted) return;

      setResult(prev => ({ ...prev, status: 'transcribing', progress: 100 }));

      // Transcribe the audio
      const output = await pipe(audioUrl, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'portuguese',
        task: 'transcribe',
      });

      if (abortControllerRef.current.signal.aborted) return;

      const transcribedText = output?.text?.trim() || '';
      
      setResult({
        text: transcribedText,
        status: 'done',
        progress: 100,
      });

      return transcribedText;
    } catch (error: any) {
      console.error('Transcription error:', error);
      
      // Check if it's a WebGPU not supported error
      const errorMessage = error.message?.includes('WebGPU') 
        ? 'WebGPU não suportado neste navegador'
        : 'Erro na transcrição';
      
      setResult({
        text: '',
        status: 'error',
        progress: 0,
        error: errorMessage,
      });
      
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setResult({ text: '', status: 'idle', progress: 0 });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    ...result,
    transcribe,
    reset,
  };
}
