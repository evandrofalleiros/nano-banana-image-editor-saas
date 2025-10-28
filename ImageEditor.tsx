import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';
import { AspectRatio, ASPECT_RATIOS } from './constants';
import { fileToBase64, getImageDimensions, createCroppedBlob } from './utils/imageUtils';
import { editImageWithPrompt } from './services/geminiService';
import { UploadIcon, SparklesIcon, SaveIcon, PhotoIcon, XCircleIcon, XIcon, GridIcon, BrushIcon, EraserIcon, TrashIcon, CropIcon, EyeIcon, CheckIcon, AdjustmentsIcon, UndoIcon, RedoIcon, ShadowIcon, EditIcon, SunIcon, ContrastIcon, DropletIcon, ColorWheelIcon, ChevronUpIcon } from './components/Icons';

interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturate: number;
  hue: number;
}

const defaultAdjustments: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
};

interface ImageState {
  id: string;
  file: File;
  base64: string;
  generatedBase64: string | null;
  maskBase64: string | null;
  crop?: Crop;
  naturalWidth: number;
  naturalHeight: number;
  adjustments: ImageAdjustments;
}

interface ImageEditorProps {
  initialImages?: {
    file: File | null;
    base64: string | null;
  }[];
  onSave: (data: { images: Blob[] }) => void;
  onClose: () => void;
}

const ENHANCEMENT_PRESETS = [
  {
    name: 'Aprimoramento Geral',
    prompt: 'Aprimore esta imagem para que tenha aparência profissional e realista. Melhore o equilíbrio de contraste e brilho, a nitidez e a vivacidade das cores, mantendo a naturalidade.',
    icon: <SparklesIcon className="w-6 h-6" />
  },
  {
    name: 'Remover Fundo',
    prompt: 'Remova o fundo desta imagem de forma precisa, deixando apenas o objeto principal com um fundo transparente.',
    icon: <EraserIcon className="w-6 h-6" />
  },
  {
    name: 'Fundo Branco',
    prompt: 'Remova o fundo da imagem e substitua-o por um fundo branco puro, de estúdio, ideal para marketplaces.',
    icon: <PhotoIcon className="w-6 h-6" />
  },
  {
    name: 'Sombra Realista',
    prompt: 'Adicione uma sombra suave e realista ao objeto principal para dar profundidade e destacá-lo do fundo. A sombra deve parecer natural, como se o objeto estivesse sobre uma superfície.',
    icon: <ShadowIcon className="w-6 h-6" />
  },
  {
    name: 'Cores Vibrantes',
    prompt: 'Ajuste as cores da imagem para torná-las mais vibrantes e atraentes, sem parecerem supersaturadas ou artificiais. O objetivo é fazer o produto parecer mais apetecível.',
    icon: <AdjustmentsIcon className="w-6 h-6" />
  }
];


// Simple media query hook
const useMediaQuery = (query: string) => {
    const [matches, setMatches] = useState(window.matchMedia(query).matches);

    useEffect(() => {
        const media = window.matchMedia(query);
        const listener = () => setMatches(media.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, [query]);

    return matches;
};

type Tool = 'crop' | 'brush' | 'adjust' | 'enhance' | 'text' | null;

export default function ImageEditor({ initialImages: initialImageData, onSave, onClose }: ImageEditorProps) {
  const [images, _setImages] = useState<ImageState[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  
  const [prompt, setPrompt] = useState<string>('');
  const [activeAspectRatio, setActiveAspectRatio] = useState<AspectRatio>(ASPECT_RATIOS[0]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState<boolean>(true);


  // State for enhancement confirmation flow
  const [pendingEnhancement, setPendingEnhancement] = useState<string | null>(null);
  const [showOriginalForCompare, setShowOriginalForCompare] = useState<boolean>(false);

  // Editing tool state
  const [activeTool, setActiveTool] = useState<Tool>(null);
  const [isMobilePanelCollapsed, setIsMobilePanelCollapsed] = useState(false);
  const [brushSize, setBrushSize] = useState<number>(30);
  const [isErasing, setIsErasing] = useState<boolean>(false);
  const [tempAdjustments, setTempAdjustments] = useState<ImageAdjustments | null>(null);

  // History state
  const history = useRef<ImageState[][]>([]);
  const historyIndex = useRef<number>(-1);
  const [_, setForceUpdate] = useState(false); // For re-rendering to update canUndo/canRedo


  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDrawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const activeImage = images.find(img => img.id === selectedImageId);

  // --- History Management ---
  const canUndo = historyIndex.current > 0;
  const canRedo = historyIndex.current < history.current.length - 1;

  const setImages = (updater: React.SetStateAction<ImageState[]>, saveToHistory = false) => {
      const newState = typeof updater === 'function' ? updater(images) : updater;
      _setImages(newState);
      if (saveToHistory) {
          const newHistory = history.current.slice(0, historyIndex.current + 1);
          newHistory.push(newState);
          history.current = newHistory;
          historyIndex.current = newHistory.length - 1;
          setForceUpdate(v => !v);
      }
  };

  const undo = useCallback(() => {
    if (historyIndex.current > 0) {
        historyIndex.current--;
        _setImages(history.current[historyIndex.current]);
        setForceUpdate(v => !v);
    }
  }, []);

  const redo = useCallback(() => {
      if (historyIndex.current < history.current.length - 1) {
          historyIndex.current++;
          _setImages(history.current[historyIndex.current]);
          setForceUpdate(v => !v);
      }
  }, []);

  // --- Keyboard Shortcuts for Undo/Redo ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) { // metaKey for macOS Command key
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault(); // Prevent browser's default undo/redo
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo]);

  const handleToolSelect = (tool: Tool) => {
    const newTool = activeTool === tool ? null : tool;
    setActiveTool(newTool);
    setIsMobilePanelCollapsed(false);
    
    // Reset states when changing tools
    if (newTool !== 'brush') {
      setIsErasing(false);
    }
    if (newTool === 'adjust' && activeImage) {
      setTempAdjustments(activeImage.adjustments);
    } else {
      setTempAdjustments(null);
    }
  };


  // Canvas Drawing Logic
  const getCanvasCoordinates = (event: MouseEvent | TouchEvent) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const touch = 'touches' in event ? event.touches[0] : null;
    const clientX = touch ? touch.clientX : (event as MouseEvent).clientX;
    const clientY = touch ? touch.clientY : (event as MouseEvent).clientY;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const coords = getCanvasCoordinates(e.nativeEvent);
    if (coords) {
        isDrawingRef.current = true;
        hasDrawnRef.current = false;
        lastPointRef.current = coords;

        // Draw a dot for single clicks, improving UX
        const ctx = maskCanvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, brushSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = ctx.strokeStyle; // Use the same color as the line
            ctx.fill();
            hasDrawnRef.current = true;
        }
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawingRef.current) return;
    
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const currentPoint = getCanvasCoordinates(e.nativeEvent);

    if (ctx && currentPoint && lastPointRef.current) {
        hasDrawnRef.current = true;
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
        lastPointRef.current = currentPoint;
    }
  };

  const stopDrawing = () => {
    if (!isDrawingRef.current) return;
    
    const wasDrawing = hasDrawnRef.current;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    hasDrawnRef.current = false;

    if (!wasDrawing) return; // Exit if no actual drawing occurred (e.g., just a click outside)

    const canvas = maskCanvasRef.current;
    if (canvas && activeImage) {
        const newMaskBase64 = canvas.toDataURL();
        // Ephemeral update without saving history
        _setImages(current => current.map(img => 
            img.id === activeImage.id ? { ...img, maskBase64: newMaskBase64 } : img
        ));
    }
  };
  
  // Effect to handle canvas setup and resizing
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    const image = imgRef.current;
    if (!canvas || !image) return;

    const resizeObserver = new ResizeObserver(() => {
        const { clientWidth, clientHeight } = image;
        if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
            canvas.width = clientWidth;
            canvas.height = clientHeight;
            // Redraw mask after resize
            if (activeImage?.maskBase64) {
                const maskImage = new Image();
                maskImage.src = activeImage.maskBase64;
                maskImage.onload = () => {
                    canvas.getContext('2d')?.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
                };
            }
        }
    });

    resizeObserver.observe(image);

    return () => resizeObserver.disconnect();
  }, [activeImage?.maskBase64]);


  // Effect to setup drawing context (brush size, color, eraser)
  useEffect(() => {
    if (activeTool !== 'brush') return;
    const ctx = maskCanvasRef.current?.getContext('2d');
    if (ctx) {
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isErasing) {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgb(139, 92, 246)'; // Indigo for regular brush
            ctx.fillStyle = 'rgb(139, 92, 246)';
        }
    }
  }, [brushSize, isErasing, activeTool]);

  const handleClearMask = () => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx && activeImage) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        _setImages(current => current.map(img => 
            img.id === activeImage.id ? { ...img, maskBase64: null } : img
        ));
    }
  };

  useEffect(() => {
    const initializeImages = async () => {
        if (initialImageData && initialImageData.length > 0) {
            const newImagesPromises = initialImageData
              .filter(d => d.file && d.base64)
              .map(async (d, index) => {
                  const { naturalWidth, naturalHeight } = await getImageDimensions(d.base64!);
                  const fullCrop: Crop = { unit: '%', x: 0, y: 0, width: 100, height: 100 };
                  return {
                      id: `${Date.now()}-${index}`,
                      file: d.file!,
                      base64: d.base64!,
                      generatedBase64: null,
                      maskBase64: null,
                      naturalWidth,
                      naturalHeight,
                      adjustments: { ...defaultAdjustments },
                      crop: fullCrop,
                  };
              });
            const newImages = await Promise.all(newImagesPromises);
            
            _setImages(newImages);
            history.current = [newImages];
            historyIndex.current = 0;
            setForceUpdate(v => !v);
            setSelectedImageId(newImages[0]?.id || null);
        }
    };
    initializeImages();
  }, [initialImageData]);

  // Set the crop state when the active image changes
  useEffect(() => {
    if (activeImage) {
        setCrop(activeImage.crop);
    }
  }, [activeImage]);
  
  // Redraw mask when active image changes. This now has a more specific dependency array.
  useEffect(() => {
    const canvas = maskCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (activeImage?.maskBase64) {
        const maskImage = new Image();
        maskImage.src = activeImage.maskBase64;
        maskImage.onload = () => {
          if (maskCanvasRef.current) {
            const currentCtx = maskCanvasRef.current.getContext('2d');
            currentCtx?.drawImage(maskImage, 0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
          }
        };
      }
    }
  }, [selectedImageId, activeImage?.maskBase64]);

  // Update image state with the latest crop
  const updateImageCrop = (id: string, newCrop: Crop) => {
    _setImages(prev => prev.map(img => img.id === id ? { ...img, crop: newCrop } : img));
  };
  
  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initialCrop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 100,
        },
        activeAspectRatio.ratio,
        width,
        height
      ),
      width,
      height
    );
    setCrop(initialCrop);
    if(selectedImageId){
      // Convert initial pixel crop to percentage for consistent storage
      const percentCrop: Crop = {
        ...initialCrop,
        unit: '%',
        x: (initialCrop.x / width) * 100,
        y: (initialCrop.y / height) * 100,
        width: (initialCrop.width / width) * 100,
        height: (initialCrop.height / height) * 100,
      }
      updateImageCrop(selectedImageId, percentCrop);
    }
  }

  const handleAspectRatioChange = (aspect: AspectRatio) => {
    setActiveAspectRatio(aspect);
    if (imgRef.current && activeImage) {
        const { naturalWidth, naturalHeight } = activeImage;
        const newCrop = centerCrop(makeAspectCrop({ unit: '%', width: 100 }, aspect.ratio, naturalWidth, naturalHeight), naturalWidth, naturalHeight);
        setCrop(newCrop);
        updateImageCrop(selectedImageId!, newCrop);
    }
  };

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setError(null);
      const newImagesPromises = Array.from(files).map(async (file: File, index) => {
        const base64 = await fileToBase64(file);
        const { naturalWidth, naturalHeight } = await getImageDimensions(base64);
        return {
          id: `${Date.now()}-${index}`,
          file,
          base64,
          generatedBase64: null,
          maskBase64: null,
          naturalWidth,
          naturalHeight,
          adjustments: { ...defaultAdjustments },
        };
      });

      try {
        const newImages = await Promise.all(newImagesPromises);
        setImages(prev => [...prev, ...newImages], true);
        if (!selectedImageId) {
          setSelectedImageId(newImages[0].id);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Falha ao processar as imagens.';
        setError(message);
        console.error(err);
      }
    }
  }, [selectedImageId, setImages]);
  
  const handleRemoveImage = (idToRemove: string) => {
    setImages(prev => {
        const remaining = prev.filter(img => img.id !== idToRemove);
        if (selectedImageId === idToRemove) {
            setSelectedImageId(remaining[0]?.id || null);
        }
        return remaining;
    }, true);
  };

  const handleGenerate = useCallback(async () => {
    if (!activeImage || !prompt) {
      setError("Por favor, selecione uma imagem e descreva a edição.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { base64, file, generatedBase64, maskBase64, adjustments } = activeImage;
      const sourceImage = generatedBase64 || base64;
      
      const tempImg = new Image();
      tempImg.src = sourceImage;
      await new Promise(res => tempImg.onload = res);

      const canvas = document.createElement('canvas');
      canvas.width = tempImg.naturalWidth;
      canvas.height = tempImg.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");
      
      ctx.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturate}%) hue-rotate(${adjustments.hue}deg)`;
      ctx.drawImage(tempImg, 0, 0);

      const imageWithAdjustmentsApplied = canvas.toDataURL(file.type);
      
      const resultBase64Raw = await editImageWithPrompt(imageWithAdjustmentsApplied, file.type, prompt, maskBase64);
      const resultMimeType = 'image/png'; // AI generation often results in PNG
      const resultBase64 = `data:${resultMimeType};base64,${resultBase64Raw}`;
      const { naturalWidth, naturalHeight } = await getImageDimensions(resultBase64);
      
      const fullCrop: Crop = { unit: '%', x: 0, y: 0, width: 100, height: 100 };
      const newFile = new File([await (await fetch(resultBase64)).blob()], 'generated-image.png', { type: resultMimeType });

      setImages(currentImages =>
        currentImages.map(img =>
          img.id === selectedImageId
            ? { ...img, generatedBase64: resultBase64, maskBase64: null, naturalWidth, naturalHeight, crop: fullCrop, adjustments: { ...defaultAdjustments }, file: newFile }
            : img
        ), true
      );

    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro inesperado ao gerar a imagem.';
      setError(message);
    } finally {
      setIsLoading(false);
      setActiveTool(null);
      setPrompt('');
    }
  }, [activeImage, prompt, selectedImageId, setImages]);

  const handleEnhanceImage = useCallback(async (enhancePrompt: string) => {
    if (!activeImage) {
      setError("Por favor, selecione uma imagem para aprimorar.");
      return;
    }
    if (!enhancePrompt) {
        setError("Nenhuma ação de aprimoramento foi selecionada.");
        return;
    }

    setIsEnhancing(true);
    setError(null);

    try {
      const { base64, file, generatedBase64, adjustments } = activeImage;
      const sourceImage = generatedBase64 || base64;
      
      const tempImg = new Image();
      tempImg.src = sourceImage;
      await new Promise(res => tempImg.onload = res);

      const canvas = document.createElement('canvas');
      canvas.width = tempImg.naturalWidth;
      canvas.height = tempImg.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");
      
      ctx.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturate}%) hue-rotate(${adjustments.hue}deg)`;
      ctx.drawImage(tempImg, 0, 0);

      const imageWithAdjustmentsApplied = canvas.toDataURL(file.type);

      const resultBase64Raw = await editImageWithPrompt(imageWithAdjustmentsApplied, file.type, enhancePrompt, null);
      const resultBase64 = `data:image/png;base64,${resultBase64Raw}`;
      
      setPendingEnhancement(resultBase64); // Set for confirmation instead of applying directly

    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro inesperado ao aprimorar a imagem.';
      setError(message);
    } finally {
      setIsEnhancing(false);
      setActiveTool(null);
    }
  }, [activeImage]);

  const handleConfirmEnhancement = async () => {
    if (!pendingEnhancement || !selectedImageId) return;

    setIsLoading(true);
    try {
        const { naturalWidth, naturalHeight } = await getImageDimensions(pendingEnhancement);
        const fullCrop: Crop = { unit: '%', x: 0, y: 0, width: 100, height: 100 };
        const newFile = new File([await (await fetch(pendingEnhancement)).blob()], 'enhanced-image.png', { type: 'image/png' });

        setImages(currentImages =>
            currentImages.map(img =>
                img.id === selectedImageId
                    ? { ...img, generatedBase64: pendingEnhancement, maskBase64: null, naturalWidth, naturalHeight, crop: fullCrop, adjustments: { ...defaultAdjustments }, file: newFile }
                    : img
            ), true
        );
        setPendingEnhancement(null);

    } catch (e) {
        console.error("Error confirming enhancement:", e);
        setError("Falha ao confirmar aprimoramento.");
        setPendingEnhancement(null);
    } finally {
        setIsLoading(false);
    }
  };

  const handleCancelEnhancement = () => {
      setPendingEnhancement(null);
  };


  const handleSave = useCallback(async () => {
    if (images.length === 0) return;

    try {
        const blobPromises = images.map(async (image) => {
            const tempImage = new Image();
            const imageLoadPromise = new Promise((resolve, reject) => {
                tempImage.onload = resolve;
                tempImage.onerror = reject;
            });
            tempImage.src = image.generatedBase64 || image.base64;
            await imageLoadPromise;

            const cropToUse = image.crop;
            
            return createCroppedBlob(
                tempImage,
                cropToUse,
                1080,
                image.adjustments
            );
        });

        const blobs = await Promise.all(blobPromises);
        onSave({ images: blobs });
    } catch (error: unknown) {
        console.error("Failed to process images for saving", error);
        const message = error instanceof Error ? `Falha ao salvar: ${error.message}` : "Falha ao preparar as imagens para salvar.";
        setError(message);
    }
  }, [images, onSave]);

  const handleAdjustmentChange = (adjustment: keyof ImageAdjustments, value: number) => {
    if (!activeImage || !tempAdjustments) return;
    const newAdjustments = { ...tempAdjustments, [adjustment]: value };
    setTempAdjustments(newAdjustments);
    // Ephemeral update without saving history
    _setImages(prev => prev.map(img => 
      img.id === activeImage.id ? { ...img, adjustments: newAdjustments } : img
    ));
  };
  
  const handleResetAdjustment = (adjustment: keyof ImageAdjustments) => {
    if (!activeImage) return;
    handleAdjustmentChange(adjustment, defaultAdjustments[adjustment]);
  }
  
  const handleConfirmAdjustments = () => {
    setImages(images, true); // This saves the current state (with temp adjustments applied) to history
    setActiveTool(null);
    setTempAdjustments(null);
  };

  const handleCancelAdjustments = () => {
    if(activeImage) {
      // Revert to original adjustments before temp changes
      const originalAdjustments = history.current[historyIndex.current].find(i => i.id === activeImage.id)?.adjustments || defaultAdjustments;
      _setImages(prev => prev.map(img => 
        img.id === activeImage.id ? { ...img, adjustments: originalAdjustments } : img
      ));
    }
    setActiveTool(null);
    setTempAdjustments(null);
  }

  const handleConfirmCrop = () => {
    setImages(images, true);
    setActiveTool(null);
  };

  const handleCancelCrop = () => {
    if(activeImage) {
      const originalCrop = history.current[historyIndex.current].find(i => i.id === activeImage.id)?.crop;
      _setImages(prev => prev.map(img =>
        img.id === activeImage.id ? { ...img, crop: originalCrop } : img
      ));
      setCrop(originalCrop);
    }
    setActiveTool(null);
  }


  const isGenerateDisabled = !activeImage || !prompt || isLoading || isEnhancing;
  const isAnyLoading = isLoading || isEnhancing;

  const originalSrc = activeImage?.generatedBase64 || activeImage?.base64;
  let displayedImageSrc = originalSrc;
  if (pendingEnhancement) {
      displayedImageSrc = showOriginalForCompare ? originalSrc : pendingEnhancement;
  }
  
  const filterStyle = activeImage ? {
      filter: `brightness(${activeImage.adjustments.brightness}%) contrast(${activeImage.adjustments.contrast}%) saturate(${activeImage.adjustments.saturate}%) hue-rotate(${activeImage.adjustments.hue}deg)`,
  } : {};
  
  const adjustmentControls: {
    id: keyof ImageAdjustments;
    name: string;
    icon: React.ReactElement;
    min: number;
    max: number;
    unit: string;
  }[] = [
    { id: 'brightness', name: 'Brilho', icon: <SunIcon className="w-5 h-5" />, min: 0, max: 200, unit: '%' },
    { id: 'contrast', name: 'Contraste', icon: <ContrastIcon className="w-5 h-5" />, min: 0, max: 200, unit: '%' },
    { id: 'saturate', name: 'Saturação', icon: <DropletIcon className="w-5 h-5" />, min: 0, max: 200, unit: '%' },
    { id: 'hue', name: 'Tonalidade', icon: <ColorWheelIcon className="w-5 h-5" />, min: -180, max: 180, unit: '°' },
  ];

  const cropperComponent = activeImage ? (
    <div className="relative w-full h-full flex items-center justify-center">
      <ReactCrop
        crop={crop}
        onChange={(pixelCrop, percentCrop) => {
          if(activeTool === 'crop'){
            setCrop(pixelCrop);
            if (selectedImageId) {
              updateImageCrop(selectedImageId, percentCrop);
            }
          }
        }}
        onComplete={(c) => {
          setCompletedCrop(c);
        }}
        aspect={activeTool === 'crop' ? activeAspectRatio.ratio : undefined}
        minWidth={100}
        ruleOfThirds
        disabled={isAnyLoading || activeTool !== 'crop'}
        className="max-w-full max-h-full"
      >
        <img
          ref={imgRef}
          src={displayedImageSrc}
          alt="Produto selecionado"
          onLoad={!activeImage.crop ? onImageLoad : undefined}
          style={{ 
            maxHeight: isDesktop ? '70vh' : 'calc(100vh - 200px)',
            ...filterStyle 
          }}
          className={isAnyLoading ? 'opacity-60' : ''}
        />
      </ReactCrop>

      <canvas
        key={displayedImageSrc}
        ref={maskCanvasRef}
        className="absolute top-0 left-0"
        style={{
          pointerEvents: (activeTool === 'brush') ? 'auto' : 'none',
          touchAction: 'none',
          width: '100%',
          height: '100%',
          opacity: 0.3,
        }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />

      {isAnyLoading && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-10">
          <svg className="animate-spin h-10 w-10 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          <p className="mt-4 font-semibold text-indigo-700">
            {isLoading ? 'Aplicando edição...' : 
             isEnhancing ? 'Aprimorando imagem...' :
             'Processando...'}
          </p>
        </div>
      )}
    </div>
  ) : (
    <div className="w-full text-center flex flex-col items-center justify-center p-10 bg-white rounded-xl shadow-lg" style={{ aspectRatio: isDesktop ? activeAspectRatio.ratio : '1 / 1' }}>
      <PhotoIcon className="w-24 h-24 text-slate-300" />
      <h2 className="mt-4 text-xl font-semibold text-slate-600">Sua imagem editada aparecerá aqui</h2>
      <p className="mt-1 text-slate-400">Envie uma ou mais imagens para começar.</p>
    </div>
  );

  const desktopLayout = (
    <div className="flex flex-row h-full font-sans bg-slate-100 text-slate-800 rounded-lg overflow-hidden">
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 z-30 p-2 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors"
          aria-label="Fechar editor"
        >
          <XIcon className="w-6 h-6" />
        </button>
        {/* Controls Panel */}
        <aside className="w-[400px] lg:w-[450px] bg-white p-6 md:p-8 shadow-lg md:shadow-xl flex flex-col space-y-6 overflow-y-auto order-2 md:order-1 flex-1 md:flex-none">
          <header className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Editor de Imagens</h1>
              <p className="text-sm text-slate-500 mt-1">Refine suas imagens de produto com IA.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={undo} disabled={!canUndo} className="p-2 rounded-md bg-white hover:bg-slate-100 text-slate-600 disabled:text-slate-300 disabled:cursor-not-allowed disabled:bg-white" aria-label="Desfazer (Ctrl+Z)">
                <UndoIcon className="w-6 h-6" />
              </button>
              <button onClick={redo} disabled={!canRedo} className="p-2 rounded-md bg-white hover:bg-slate-100 text-slate-600 disabled:text-slate-300 disabled:cursor-not-allowed disabled:bg-white" aria-label="Refazer (Ctrl+Shift+Z)">
                <RedoIcon className="w-6 h-6" />
              </button>
            </div>
          </header>
  
          {/* Step 1: Upload Image */}
          <div className="space-y-4">
            <label className="text-lg font-semibold text-slate-700">1. Envie suas Imagens</label>
            <input
              type="file"
              accept="image/png, image/jpeg, image/webp"
              ref={fileInputRef}
              onChange={handleImageUpload}
              className="hidden"
              multiple // Allow multiple files
              disabled={isAnyLoading}
            />
            <div className="grid grid-cols-4 gap-2">
              {images.map(image => (
                   <div key={image.id} className="relative group">
                      <button 
                          onClick={() => setSelectedImageId(image.id)}
                          disabled={isAnyLoading}
                          className={`w-full aspect-square rounded-md overflow-hidden border-2 transition-colors ${selectedImageId === image.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-400'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200`}
                      >
                          <img src={image.generatedBase64 || image.base64} alt="Thumbnail" className="w-full h-full object-cover" style={{filter: `brightness(${image.adjustments.brightness}%) contrast(${image.adjustments.contrast}%) saturate(${image.adjustments.saturate}%) hue-rotate(${image.adjustments.hue}deg)`}}/>
                      </button>
                      <button
                          onClick={() => handleRemoveImage(image.id)}
                          disabled={isAnyLoading}
                          className="absolute -top-2 -right-2 p-1 bg-slate-600 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Remover imagem"
                      >
                          <XCircleIcon className="w-5 h-5" />
                      </button>
                   </div>
              ))}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isAnyLoading}
                className="w-full aspect-square flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:bg-slate-50 hover:border-indigo-500 hover:text-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-slate-300 disabled:hover:text-slate-500"
              >
                <UploadIcon className="w-8 h-8" />
                <span className="text-xs font-medium mt-1">Adicionar</span>
              </button>
            </div>
          </div>
          
          {images.length > 0 && (
            <>
              <div className="pt-4 border-t border-slate-200 space-y-4">
                  <h2 className="text-lg font-semibold text-slate-700">2. Edição da Imagem Selecionada</h2>
  
                  <div className="grid grid-cols-4 gap-2">
                      <button 
                          onClick={() => handleToolSelect('crop')} 
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${activeTool === 'crop' ? 'bg-green-100 text-green-700' : 'text-slate-600 hover:bg-slate-100'}`} 
                          disabled={isAnyLoading || !!pendingEnhancement}
                      >
                          <CropIcon className={`w-8 h-8 ${activeTool === 'crop' ? 'text-green-700' : 'text-green-600'}`} />
                          <span className="text-xs font-semibold mt-1">Cortar</span>
                      </button>
                       <button 
                          onClick={() => handleToolSelect('adjust')} 
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${activeTool === 'adjust' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`} 
                          disabled={isAnyLoading || !!pendingEnhancement}
                      >
                          <AdjustmentsIcon className={`w-8 h-8 ${activeTool === 'adjust' ? 'text-blue-700' : 'text-blue-600'}`} />
                          <span className="text-xs font-semibold mt-1">Ajustes</span>
                      </button>
                       <button 
                          onClick={() => handleToolSelect('brush')} 
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${activeTool === 'brush' ? 'bg-purple-100 text-purple-700' : 'text-slate-600 hover:bg-slate-100'}`} 
                          disabled={isAnyLoading || !!pendingEnhancement}
                      >
                          <BrushIcon className={`w-8 h-8 ${activeTool === 'brush' ? 'text-purple-700' : 'text-purple-600'}`} />
                          <span className="text-xs font-semibold mt-1">Pincel</span>
                      </button>
                      <button 
                          onClick={() => handleToolSelect('enhance')}
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${activeTool === 'enhance' ? 'bg-yellow-100 text-yellow-700' : 'text-slate-600 hover:bg-slate-100'}`}
                          disabled={isAnyLoading || !!pendingEnhancement || !activeImage}
                      >
                          <SparklesIcon className={`w-8 h-8 ${activeTool === 'enhance' ? 'text-yellow-700' : 'text-yellow-600'}`} />
                          <span className="text-xs font-semibold mt-1">Aprimorar</span>
                      </button>
                  </div>
                  
                  <div className="min-h-[120px]">
                      {activeTool === 'crop' && (
                          <div className="space-y-4">
                              <div>
                                  <label className="font-medium text-slate-600">Proporção</label>
                                  <div className="grid grid-cols-5 gap-2 mt-3">
                                      {ASPECT_RATIOS.map((aspect) => (
                                      <button key={aspect.name} onClick={() => handleAspectRatioChange(aspect)} 
                                      disabled={isAnyLoading}
                                      className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${activeAspectRatio.name === aspect.name ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-300 bg-transparent hover:border-slate-400'} disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent disabled:hover:border-slate-300 disabled:text-slate-500 disabled:hover:bg-transparent`}>
                                          {aspect.icon}
                                          <span className="text-[10px] font-medium mt-1">{aspect.name}</span>
                                      </button>
                                      ))}
                                  </div>
                              </div>
                              <button
                                  onClick={handleConfirmCrop}
                                  className="w-full py-2 px-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
                              >
                                  Confirmar Corte
                              </button>
                        </div>
                      )}
                      
                      {activeTool === 'adjust' && activeImage && tempAdjustments && (
                          <div className="space-y-3">
                              <div className="space-y-2">
                                  <div className="flex justify-between items-center text-sm">
                                      <label htmlFor="brightness" className="font-medium text-slate-600">Brilho</label>
                                      <span className="text-slate-500 font-mono text-xs w-10 text-right">{tempAdjustments.brightness}%</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                  <input id="brightness" type="range" min="0" max="200" value={tempAdjustments.brightness} onChange={e => handleAdjustmentChange('brightness', Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                                  <button onClick={() => handleResetAdjustment('brightness')} className="text-xs text-slate-500 hover:text-indigo-600">Reset</button>
                                  </div>
                              </div>
                              <div className="space-y-2">
                                  <div className="flex justify-between items-center text-sm">
                                      <label htmlFor="contrast" className="font-medium text-slate-600">Contraste</label>
                                      <span className="text-slate-500 font-mono text-xs w-10 text-right">{tempAdjustments.contrast}%</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                  <input id="contrast" type="range" min="0" max="200" value={tempAdjustments.contrast} onChange={e => handleAdjustmentChange('contrast', Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                                   <button onClick={() => handleResetAdjustment('contrast')} className="text-xs text-slate-500 hover:text-indigo-600">Reset</button>
                                  </div>
                              </div>
                              <div className="space-y-2">
                                  <div className="flex justify-between items-center text-sm">
                                      <label htmlFor="saturate" className="font-medium text-slate-600">Saturação</label>
                                      <span className="text-slate-500 font-mono text-xs w-10 text-right">{tempAdjustments.saturate}%</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                  <input id="saturate" type="range" min="0" max="200" value={tempAdjustments.saturate} onChange={e => handleAdjustmentChange('saturate', Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                                  <button onClick={() => handleResetAdjustment('saturate')} className="text-xs text-slate-500 hover:text-indigo-600">Reset</button>
                                  </div>
                              </div>
                              <div className="space-y-2">
                                  <div className="flex justify-between items-center text-sm">
                                      <label htmlFor="hue" className="font-medium text-slate-600">Tonalidade</label>
                                      <span className="text-slate-500 font-mono text-xs w-10 text-right">{tempAdjustments.hue}°</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                  <input id="hue" type="range" min="-180" max="180" value={tempAdjustments.hue} onChange={e => handleAdjustmentChange('hue', Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                                  <button onClick={() => handleResetAdjustment('hue')} className="text-xs text-slate-500 hover:text-indigo-600">Reset</button>
                                  </div>
                              </div>
                               <div className="flex items-center gap-2 pt-2">
                                  <button onClick={handleCancelAdjustments} className="flex-1 text-sm text-slate-600 font-semibold hover:text-slate-800 transition-colors">Cancelar</button>
                                  <button 
                                    onClick={handleConfirmAdjustments} 
                                    className="flex-1 py-2 px-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors text-sm"
                                  >
                                    Confirmar Ajustes
                                  </button>
                              </div>
                          </div>
                      )}
  
                      {activeTool === 'brush' && (
                          <div className="space-y-3">
                              <p className="text-xs text-slate-500">Pinte a área que deseja editar. Se nada for selecionado, a edição será aplicada na imagem toda.</p>
                              
                              <div className="bg-slate-50 p-3 rounded-lg space-y-4">
                                  <div>
                                  <label htmlFor="brush-size" className="text-sm font-medium text-slate-500">Tamanho do Pincel</label>
                                  <input id="brush-size" type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                                  </div>
                                  <div className="flex items-center gap-2">
                                  <button onClick={() => setIsErasing(false)} className={`flex-1 py-2 px-3 text-sm rounded-md flex items-center justify-center gap-2 transition-colors ${!isErasing ? 'bg-indigo-500 text-white' : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'}`}>
                                      <BrushIcon className="w-5 h-5"/> Pincel
                                  </button>
                                  <button onClick={() => setIsErasing(true)} className={`flex-1 py-2 px-3 text-sm rounded-md flex items-center justify-center gap-2 transition-colors ${isErasing ? 'bg-indigo-500 text-white' : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'}`}>
                                      <EraserIcon className="w-5 h-5"/> Borracha
                                  </button>
                                  <button onClick={handleClearMask} className="p-2 bg-white hover:bg-slate-200 text-slate-600 rounded-md border border-slate-300" aria-label="Limpar máscara">
                                      <TrashIcon className="w-5 h-5" />
                                  </button>
                                  </div>
                              </div>
                          </div>
                      )}
  
                      {activeTool === 'enhance' && (
                          <div className="space-y-3">
                              <p className="text-sm text-slate-600">Escolha um aprimoramento rápido:</p>
                              <div className="grid grid-cols-1 gap-2">
                                  {ENHANCEMENT_PRESETS.map(preset => (
                                      <button
                                          key={preset.name}
                                          onClick={() => handleEnhanceImage(preset.prompt)}
                                          disabled={isEnhancing}
                                          className="flex items-center gap-3 p-3 w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                          <div className="text-indigo-500 bg-indigo-100 p-2 rounded-md">
                                              {preset.icon}
                                          </div>
                                          <div>
                                              <h4 className="font-semibold text-slate-800">{preset.name}</h4>
                                          </div>
                                      </button>
                                  ))}
                              </div>
                          </div>
                      )}
  
                  </div>
  
                  {pendingEnhancement && (
                    <div className="space-y-4 pt-4 border-t border-slate-200 bg-indigo-50 p-4 rounded-lg">
                        <h3 className="font-semibold text-center text-indigo-800">Revisar Aprimoramento</h3>
                        <p className="text-xs text-center text-indigo-700">O resultado parece bom? Mantenha pressionado "Comparar" para ver o original.</p>
                        
                        <button 
                            onMouseDown={() => setShowOriginalForCompare(true)}
                            onMouseUp={() => setShowOriginalForCompare(false)}
                            onMouseLeave={() => setShowOriginalForCompare(false)}
                            onTouchStart={() => setShowOriginalForCompare(true)}
                            onTouchEnd={() => setShowOriginalForCompare(false)}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white text-slate-700 font-semibold rounded-lg border border-slate-300 hover:bg-slate-100 transition-colors"
                            title="Segure para ver a imagem original"
                        >
                            <EyeIcon className="w-5 h-5" />
                            Comparar com Anterior
                        </button>
                        
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={handleCancelEnhancement} 
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white text-red-600 font-semibold rounded-lg border border-slate-300 hover:bg-red-50 hover:border-red-300 transition-colors"
                            >
                                <XIcon className="w-5 h-5" />
                                Descartar
                            </button>
                            <button 
                                onClick={handleConfirmEnhancement} 
                                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-green-600 text-white font-semibold rounded-lg shadow-sm hover:bg-green-700 transition-colors"
                            >
                                <CheckIcon className="w-5 h-5" />
                                Confirmar
                            </button>
                        </div>
                    </div>
                  )}
  
  
                  {!pendingEnhancement && (
                      <>
                          <div className="space-y-3 pt-4 border-t border-slate-200">
                               <div>
                                  <label htmlFor="prompt" className="font-medium text-slate-600">Edite com um comando de texto</label>
                                  <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex: 'Remova o fundo e substitua por uma cor cinza claro'." className="w-full mt-2 p-3 border-2 border-slate-300 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow disabled:bg-slate-100" rows={3} disabled={isAnyLoading} />
                              </div>
                          </div>
  
                          <div className="pt-4">
                              <button onClick={handleGenerate} disabled={isGenerateDisabled} className="w-full flex items-center justify-center py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all">
                                  {isLoading ? (<><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Gerando...</>) : (<><SparklesIcon className="w-5 h-5 mr-2" />Gerar Edição</>)}
                              </button>
                              {error && <p className="text-sm text-red-500 mt-3 text-center">{error}</p>}
                          </div>
                      </>
                  )}
              </div>
            </>
          )}
        </aside>
        
        <main className="p-4 md:p-8 flex flex-col items-center justify-center order-1 md:order-2 flex-none md:flex-1">
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
            <div className="bg-white rounded-xl shadow-lg p-2 mb-4">
                {cropperComponent}
            </div>
            <button
                onClick={handleSave}
                disabled={isAnyLoading}
                className="mt-6 flex items-center justify-center py-2 px-5 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
                <SaveIcon className="w-5 h-5 mr-2" />
                Salvar Todas as Alterações
            </button>
            </div>
        </main>
    </div>
  );

  const mobileLayout = (
    <div className="w-full h-full flex flex-col bg-slate-900 text-white font-sans">
      <header className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center p-4 bg-gradient-to-b from-black/50 to-transparent">
        <button onClick={onClose} className="p-2 rounded-full bg-black/30 backdrop-blur-sm">
          <XIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
            <button onClick={undo} disabled={!canUndo} className="p-2 rounded-full bg-black/30 backdrop-blur-sm disabled:opacity-50">
              <UndoIcon className="w-6 h-6" />
            </button>
            <button onClick={redo} disabled={!canRedo} className="p-2 rounded-full bg-black/30 backdrop-blur-sm disabled:opacity-50">
              <RedoIcon className="w-6 h-6" />
            </button>
        </div>
        <button onClick={handleSave} disabled={isAnyLoading} className="py-2 px-4 text-sm font-semibold bg-indigo-600 rounded-lg shadow-lg hover:bg-indigo-500 disabled:bg-slate-500">
          Salvar
        </button>
      </header>
      
      <main className="flex-1 flex items-center justify-center p-4 pt-20 pb-40 overflow-hidden">
        {activeImage ? cropperComponent : (
            <div className="w-full text-center flex flex-col items-center justify-center p-4">
                <PhotoIcon className="w-24 h-24 text-slate-600" />
                <h2 className="mt-4 text-xl font-semibold text-slate-300">Nenhuma imagem selecionada</h2>
                <p className="mt-1 text-slate-400">Envie uma imagem para começar.</p>
                <button onClick={() => fileInputRef.current?.click()} className="mt-6 flex items-center gap-2 py-2 px-4 bg-indigo-600 text-white font-semibold rounded-lg">
                    <UploadIcon className="w-5 h-5" />
                    Enviar Imagem
                </button>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/png, image/jpeg, image/webp" multiple />
            </div>
        )}
      </main>

      <footer className="absolute bottom-0 left-0 right-0 z-20 flex flex-col">
        {showThumbnails && images.length > 0 && (
             <div className="w-full overflow-x-auto p-2">
                <div className="flex items-center gap-2 w-max mx-auto">
                    {images.map(image => (
                        <div key={image.id} className="relative group">
                            <button
                                onClick={() => setSelectedImageId(image.id)}
                                className={`w-14 h-14 rounded-md overflow-hidden border-2 transition-all ${selectedImageId === image.id ? 'border-indigo-400 scale-105' : 'border-transparent'}`}
                            >
                                <img src={image.generatedBase64 || image.base64} alt="Thumbnail" className="w-full h-full object-cover"/>
                            </button>
                        </div>
                    ))}
                    <button onClick={() => fileInputRef.current?.click()} className="w-14 h-14 flex items-center justify-center bg-slate-800/50 rounded-md">
                        <UploadIcon className="w-6 h-6 text-slate-300"/>
                    </button>
                     <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/png, image/jpeg, image/webp" multiple />
                </div>
            </div>
        )}

        {/* Main Toolbar */}
        {activeTool === null && images.length > 0 && (
            <div className="bg-slate-900/80 backdrop-blur-sm flex justify-around items-center p-2">
              <button onClick={() => setShowThumbnails(!showThumbnails)} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${showThumbnails ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <GridIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Galeria</span>
              </button>
              <button onClick={() => handleToolSelect('crop')} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${activeTool === 'crop' ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <CropIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Cortar</span>
              </button>
               <button onClick={() => handleToolSelect('adjust')} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${activeTool === 'adjust' ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <AdjustmentsIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Ajustes</span>
              </button>
              <button onClick={() => handleToolSelect('brush')} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${activeTool === 'brush' ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <BrushIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Pincel</span>
              </button>
              <button onClick={() => handleToolSelect('text')} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${activeTool === 'text' ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <EditIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Texto</span>
              </button>
              <button onClick={() => handleToolSelect('enhance')} className={`flex flex-col items-center gap-1 w-16 p-2 rounded-lg transition-colors ${activeTool === 'enhance' ? 'text-indigo-400' : 'text-slate-300'}`}>
                  <SparklesIcon className="w-6 h-6" />
                  <span className="text-xs font-medium">Aprimorar</span>
              </button>
            </div>
        )}

        {/* Tool-specific Panels */}
        <div className={`bg-white text-slate-800 rounded-t-2xl transition-transform duration-300 ${activeTool ? 'translate-y-0' : 'translate-y-full'}`}>
          <button
            onClick={() => setIsMobilePanelCollapsed(!isMobilePanelCollapsed)}
            className="w-full flex justify-center pt-4 pb-2"
            aria-label={isMobilePanelCollapsed ? 'Expandir painel' : 'Recolher painel'}
          >
            <div className="w-10 h-1.5 bg-slate-300 rounded-full" />
          </button>
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isMobilePanelCollapsed ? 'max-h-0' : 'max-h-[70vh] overflow-y-auto'}`}>
            <div className="px-4 pb-4">
              {activeTool === 'crop' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-5 gap-2">
                    {ASPECT_RATIOS.map(aspect => (
                      <button key={aspect.name} onClick={() => handleAspectRatioChange(aspect)} className={`flex flex-col items-center justify-center p-2 rounded-lg transition-all ${activeAspectRatio.name === aspect.name ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100'}`}>
                        {aspect.icon} <span className="text-[10px] mt-1">{aspect.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleCancelCrop} className="flex-1 py-3 rounded-lg bg-slate-200 text-slate-800 font-semibold text-sm">Cancelar</button>
                    <button onClick={handleConfirmCrop} className="flex-1 py-3 rounded-lg bg-indigo-600 text-white font-semibold text-sm">Confirmar</button>
                  </div>
                </div>
              )}

              {activeTool === 'adjust' && activeImage && tempAdjustments && (
                 <div className="space-y-4">
                    <div className="space-y-4">
                        {adjustmentControls.map(control => (
                            <div key={control.id}>
                                <div className="flex justify-between items-center mb-1">
                                    <div className="flex items-center gap-2">
                                        {React.cloneElement(control.icon, { className: 'w-5 h-5 text-slate-500' })}
                                        <label className="text-sm font-medium text-slate-700">{control.name}</label>
                                    </div>
                                    <span className="text-sm font-mono text-slate-500">{tempAdjustments[control.id]}{control.unit}</span>
                                </div>
                                <input
                                    type="range"
                                    min={control.min}
                                    max={control.max}
                                    value={tempAdjustments[control.id]}
                                    onChange={e => handleAdjustmentChange(control.id, Number(e.target.value))}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:bg-indigo-600"
                                />
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                        <button onClick={handleCancelAdjustments} className="flex-1 py-3 rounded-lg bg-slate-200 text-slate-800 font-semibold text-sm">Cancelar</button>
                        <button onClick={handleConfirmAdjustments} className="flex-1 py-3 rounded-lg bg-indigo-600 text-white font-semibold text-sm">Confirmar</button>
                    </div>
                </div>
              )}

              {(activeTool === 'brush' || activeTool === 'text') && (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-center text-slate-800">
                        {activeTool === 'brush' ? 'Edição com Pincel' : 'Edição por Texto'}
                    </h3>
                    
                    <p className="text-sm text-center text-slate-500 -mt-2">
                        {activeTool === 'brush' 
                            ? 'Pinte a área que deseja editar e descreva a alteração.' 
                            : 'Descreva a alteração que você deseja aplicar na imagem.'}
                    </p>

                    <textarea 
                        value={prompt} 
                        onChange={e => setPrompt(e.target.value)} 
                        placeholder="Ex: Adicione uma sombra realista..." 
                        className="w-full p-3 bg-slate-50 border-slate-300 border rounded-lg text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" 
                        rows={3}
                    />
                    
                    {activeTool === 'brush' && (
                        <div className="bg-slate-50 p-3 rounded-lg space-y-4">
                            <div>
                                <label htmlFor="brush-size-mobile" className="text-sm font-medium text-slate-600">Tamanho do Pincel</label>
                                <input id="brush-size-mobile" type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:bg-indigo-600 [&::-moz-range-thumb]:bg-indigo-600 mt-1" />
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setIsErasing(false)} className={`flex-1 py-2 px-3 text-sm rounded-md flex items-center justify-center gap-2 transition-colors ${!isErasing ? 'bg-indigo-500 text-white' : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'}`}>
                                    <BrushIcon className="w-5 h-5"/> Pincel
                                </button>
                                <button onClick={() => setIsErasing(true)} className={`flex-1 py-2 px-3 text-sm rounded-md flex items-center justify-center gap-2 transition-colors ${isErasing ? 'bg-indigo-500 text-white' : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'}`}>
                                    <EraserIcon className="w-5 h-5"/> Borracha
                                </button>
                                <button onClick={handleClearMask} className="p-2 bg-white hover:bg-slate-200 text-slate-600 rounded-md border border-slate-300" aria-label="Limpar máscara">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2 pt-2">
                        <button onClick={() => { setActiveTool(null); setPrompt('')}} className="flex-1 py-3 rounded-lg bg-slate-200 text-slate-800 font-semibold text-sm">Cancelar</button>
                        <button onClick={handleGenerate} disabled={isGenerateDisabled} className="flex-1 py-3 rounded-lg bg-indigo-600 text-white font-semibold text-sm disabled:bg-slate-400">Gerar</button>
                    </div>
                </div>
              )}

              {activeTool === 'enhance' && (
                 <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-center text-slate-800">Aprimoramento Rápido</h3>
                    <p className="text-sm text-center text-slate-500 -mt-2">
                        Aplique edições pré-definidas com um toque.
                    </p>

                    <div className="space-y-2">
                        {ENHANCEMENT_PRESETS.map(preset => (
                            <button 
                                key={preset.name} 
                                onClick={() => handleEnhanceImage(preset.prompt)} 
                                disabled={isEnhancing} 
                                className="flex items-center gap-3 p-3 w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <div className="text-indigo-500 bg-indigo-100 p-2 rounded-md">
                                    {preset.icon}
                                </div>
                                <div>
                                    <h4 className="font-semibold text-slate-800 text-sm">{preset.name}</h4>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="pt-2">
                        <button
                            onClick={() => setActiveTool(null)}
                            className="w-full py-3 rounded-lg bg-slate-200 text-slate-800 font-semibold text-sm"
                        >
                            Fechar
                        </button>
                    </div>
                 </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );

  return isDesktop ? desktopLayout : mobileLayout;
}
