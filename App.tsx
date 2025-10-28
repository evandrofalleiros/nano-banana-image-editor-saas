

import React, { useState, useCallback, useRef } from 'react';
import ImageEditor from './ImageEditor';
import { EditIcon, SparklesIcon, UploadIcon, CopyIcon } from './components/Icons';
import { enhanceProductDescription, generateProductDescription } from './services/geminiService';
import { fileToBase64 } from './utils/imageUtils';

type Formality = 'descontraido' | 'profissional' | 'formal';

const formalityOptions: { id: Formality; label: string }[] = [
    { id: 'descontraido', label: 'Descontraído' },
    { id: 'profissional', label: 'Profissional' },
    { id: 'formal', label: 'Formal' },
];

export default function App() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [productImages, setProductImages] = useState<string[]>([]);
  
  const [userProductInfo, setUserProductInfo] = useState<string>('');
  const [productDescription, setProductDescription] = useState<string>('');
  const [isGeneratingDescription, setIsGeneratingDescription] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<string>('');
  const [formality, setFormality] = useState<Formality>('profissional');

  const [initialImageData, setInitialImageData] = useState<{ file: File; base64: string; }[] | undefined>(undefined);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenEditor = async () => {
    if (productImages.length > 0) {
        try {
            const imageDataPromises = productImages.map(async (imageUrl, index) => {
                const response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`Falha ao buscar a imagem: ${response.statusText}`);
                }
                const blob = await response.blob();
                const file = new File([blob], `initial-image-${index}.png`, { type: blob.type || 'image/png' });
                
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                return { file, base64 };
            });
            
            const loadedImages = await Promise.all(imageDataPromises);
            setInitialImageData(loadedImages);
        } catch (error: unknown) {
            console.error("Erro ao preparar imagens iniciais:", error);
            setInitialImageData(undefined);
        }
    } else {
        setInitialImageData(undefined);
    }
    setIsEditorOpen(true);
  };

  const handleInitialUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
        try {
            const imageDataPromises = Array.from(files).map(async (file: File) => {
                const base64 = await fileToBase64(file);
                return { file, base64 };
            });
            const loadedImages = await Promise.all(imageDataPromises);
            setInitialImageData(loadedImages);
            setIsEditorOpen(true);
        } catch (error: unknown) {
            console.error("Erro ao carregar imagens:", error);
        }
    }
    if (event.target) {
        event.target.value = '';
    }
  };

  const handlePrimaryButtonClick = () => {
    if (productImages.length > 0) {
        handleOpenEditor();
    } else {
        fileInputRef.current?.click();
    }
  };

  const handleCloseEditor = useCallback(() => {
    setIsEditorOpen(false);
    setInitialImageData(undefined);
  }, []);

  const handleSaveImages = useCallback((data: { images: Blob[] }) => {
    productImages.forEach(url => {
        if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    });
    const newImageUrls = data.images.map(blob => URL.createObjectURL(blob));
    setProductImages(newImageUrls);
    console.log("Imagens salvas!", data);
    handleCloseEditor();
  }, [productImages, handleCloseEditor]);

  const handleGenerateDescription = async () => {
    const firstImageUrl = productImages[0];
    if (!firstImageUrl) {
      alert("Por favor, salve uma imagem primeiro para usar como referência.");
      return;
    }

    setIsGeneratingDescription(true);
    try {
      const response = await fetch(firstImageUrl);
      if (!response.ok) {
        throw new Error('Falha ao buscar a imagem para gerar a descrição.');
      }
      const blob = await response.blob();
      const base64 = await fileToBase64(new File([blob], 'temp-image', { type: blob.type }));
      
      const description = await generateProductDescription(base64, blob.type, userProductInfo, formality);
      setProductDescription(description);
    } catch (error: unknown) {
      console.error("Falha ao gerar a descrição", error);
      const message = error instanceof Error ? error.message : "Não foi possível gerar a descrição. Tente novamente.";
      alert(message);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleEnhanceDescription = async () => {
    if (!productDescription) return;

    setIsEnhancing(true);
    try {
        const enhancedText = await enhanceProductDescription(productDescription);
        setProductDescription(enhancedText);
    } catch (error: unknown) {
        console.error("Failed to enhance description", error);
        const message = error instanceof Error ? error.message : "Não foi possível aprimorar a descrição. Tente novamente.";
        alert(message);
    } finally {
        setIsEnhancing(false);
    }
  };

  const handleCopyDescription = () => {
    navigator.clipboard.writeText(productDescription).then(() => {
        setCopySuccess('Copiado!');
        setTimeout(() => setCopySuccess(''), 2000);
    }, (err) => {
        console.error('Não foi possível copiar o texto: ', err);
    });
  };

  return (
    <div className="w-full min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Simulação de ERP</h1>
        <p className="text-slate-500 mb-6">Esta é uma página simulada do seu produto no ERP.</p>
        
        {/* Description Section */}
        <div className="space-y-6 my-8 pt-6 border-t border-slate-200">
            <div className="space-y-4">
              <label htmlFor="user-product-info" className="font-semibold text-slate-700">Descreva seu Produto</label>
              <p className="text-sm text-slate-500">Forneça informações básicas para a IA gerar uma descrição completa.</p>
              <textarea
                id="user-product-info"
                value={userProductInfo}
                onChange={(e) => setUserProductInfo(e.target.value)}
                placeholder="Ex: 'Camiseta de algodão com estampa de gato'."
                className="w-full p-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                rows={2}
              />
            </div>

            <div className="space-y-2">
                <label className="font-semibold text-slate-700">Tom de Voz</label>
                <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg">
                    {formalityOptions.map(option => (
                        <button 
                            key={option.id}
                            onClick={() => setFormality(option.id)}
                            className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-all ${formality === option.id ? 'bg-white text-indigo-600 shadow-sm' : 'bg-transparent text-slate-600 hover:bg-white/60'}`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label htmlFor="description" className="font-semibold text-slate-700">Descrição para Marketplace (Gerada por IA)</label>
                <button 
                  onClick={handleGenerateDescription} 
                  disabled={isGeneratingDescription || productImages.length === 0} 
                  className="flex items-center gap-2 text-sm py-2 px-4 bg-indigo-100 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-200 disabled:bg-slate-200 disabled:text-slate-500 transition-colors"
                >
                  <SparklesIcon className="w-4 h-4" />
                  {isGeneratingDescription ? 'Gerando...' : 'Gerar com IA'}
                </button>
              </div>
              <div className="relative">
                <textarea 
                  id="description" 
                  value={productDescription} 
                  onChange={(e) => setProductDescription(e.target.value)} 
                  placeholder="A descrição gerada pela IA aparecerá aqui. Baseia-se na primeira imagem e no texto acima." 
                  className="w-full p-3 pr-10 border border-slate-300 rounded-lg bg-slate-50 text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" 
                  rows={5} 
                />
                 {productDescription && (
                    <>
                        <button onClick={handleCopyDescription} className="absolute top-2 right-2 p-2 text-slate-500 hover:text-indigo-600 rounded-md transition-colors" aria-label="Copiar descrição"><CopyIcon className="w-5 h-5" /></button>
                        {copySuccess && <div className="absolute bottom-2 right-2 text-xs text-green-600 bg-green-100 px-2 py-1 rounded transition-opacity">{copySuccess}</div>}
                    </>
                )}
              </div>
              <div className="flex justify-end">
                 <button 
                    onClick={handleEnhanceDescription}
                    disabled={isEnhancing || !productDescription}
                    className="flex items-center gap-2 py-2 px-4 bg-indigo-100 text-indigo-700 font-semibold rounded-lg shadow-sm hover:bg-indigo-200 transition-colors text-sm disabled:bg-slate-200 disabled:text-slate-500"
                >
                    <SparklesIcon className="w-4 h-4" />
                    {isEnhancing ? 'Aprimorando...' : 'Aprimorar Texto'}
                </button>
              </div>
            </div>
        </div>

        <input
            type="file"
            ref={fileInputRef}
            onChange={handleInitialUpload}
            className="hidden"
            accept="image/png, image/jpeg, image/webp"
            multiple
        />

        <div className="space-y-4 pt-6 border-t border-slate-200">
          <div className="flex justify-between items-center">
            <label className="font-semibold text-slate-700">Imagens do Produto</label>
            <button 
                onClick={handlePrimaryButtonClick}
                className="flex items-center gap-2 py-2 px-4 bg-slate-100 text-slate-800 font-semibold rounded-lg shadow-sm hover:bg-slate-200 transition-colors text-sm"
              >
                {productImages.length > 0 ? (
                    <>
                        <EditIcon className="w-4 h-4" />
                        Editar com IA
                    </>
                ) : (
                    <>
                        <UploadIcon className="w-4 h-4" />
                        Enviar imagens
                    </>
                )}
            </button>
          </div>
          <div className="relative group w-full border rounded-lg p-4 flex items-center justify-center overflow-hidden bg-slate-50 min-h-[256px]">
            {productImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                    {productImages.map((src, index) => (
                         <img key={index} src={src} alt={`Produto ${index + 1}`} className="w-full h-full object-cover rounded-md shadow-sm" />
                    ))}
                </div>
            ) : (
              <div className="text-center text-slate-500">
                <UploadIcon className="w-12 h-12 mx-auto text-slate-400 mb-2" />
                <p className="font-semibold">Faça o upload de suas imagens para edição</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isEditorOpen && (
        <div className="fixed inset-0 bg-black/60 z-10 flex items-center justify-center p-4" aria-modal="true">
            <div className="w-full h-full max-w-7xl max-h-[90vh] bg-white rounded-xl shadow-2xl">
               <ImageEditor 
                  initialImages={initialImageData}
                  onSave={handleSaveImages}
                  onClose={handleCloseEditor}
               />
            </div>
        </div>
      )}
    </div>
  );
}