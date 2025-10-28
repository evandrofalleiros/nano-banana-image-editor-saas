import { GoogleGenAI, Modality } from "@google/genai";

// FIX: Initialize GoogleGenAI client strictly with process.env.API_KEY as per guidelines.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Extracts raw base64 data from a data URL string.
 * If the string is not a data URL, it's returned as is.
 * @param dataUrl The base64 string, possibly with a data URL prefix.
 * @returns The raw base64 data.
 */
const getRawBase64 = (dataUrl: string): string => {
    const parts = dataUrl.split(',');
    return parts.length > 1 ? parts[1] : dataUrl;
};


export async function editImageWithPrompt(
    base64Image: string,
    mimeType: string,
    prompt: string,
    maskBase64?: string | null
): Promise<string> {
    try {
        // The order of parts is critical for mask-based editing (inpainting).
        // The most reliable order is [image, mask, prompt].
        const parts: any[] = [];

        // 1. Add the main image first.
        const imagePart = {
            inlineData: {
                data: getRawBase64(base64Image),
                mimeType: mimeType,
            },
        };
        parts.push(imagePart);
        
        // 2. Add the mask second, if it exists.
        if (maskBase64) {
            const maskPart = {
                inlineData: {
                    data: getRawBase64(maskBase64),
                    mimeType: 'image/png', // Masks should be PNG to support transparency
                },
            };
            parts.push(maskPart);
        }
        
        // 3. Add the text prompt last.
        // When a mask is used, sending the user's prompt directly is more effective.
        // When no mask is present, wrap the prompt with context to mitigate safety flags and improve clarity.
        const instructionalPrompt = !maskBase64
            ? `Edite esta imagem de produto para um e-commerce. A tarefa é: '${prompt}'. A edição deve ser profissional e adequada para um site de vendas.`
            : prompt;

        const textPart = {
            text: instructionalPrompt,
        };
        parts.push(textPart);


        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            // FIX: Wrap the content object in an array. Multi-modal models often expect `contents` as an array of turns.
            contents: [{
                parts: parts,
            }],
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        const firstCandidate = response.candidates?.[0];
        
        if (!firstCandidate || !firstCandidate.content?.parts) {
            let errorMessage = "A resposta da IA não contém conteúdo. A solicitação pode ter sido bloqueada.";
            if (firstCandidate?.finishReason === 'SAFETY') {
                errorMessage = "A geração de imagem foi bloqueada por motivos de segurança. Por favor, ajuste seu prompt.";
            } else if (firstCandidate?.finishReason && firstCandidate.finishReason !== 'STOP') {
                errorMessage = `A geração de imagem falhou. Motivo: ${firstCandidate.finishReason}.`;
            }
            throw new Error(errorMessage);
        }

        const imageResponsePart = firstCandidate.content.parts.find(part => part.inlineData);

        if (imageResponsePart?.inlineData) {
            return imageResponsePart.inlineData.data;
        } else {
            const textResponse = firstCandidate.content.parts.find(part => part.text)?.text;
            if(textResponse) {
                throw new Error(`A IA retornou um texto em vez de uma imagem: "${textResponse}"`);
            }
            throw new Error("Nenhum dado de imagem encontrado na resposta da IA.");
        }

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        if (error instanceof Error) {
             // Include the specific API reason in the thrown error message if available
            if (error.message.includes('A geração de imagem falhou.')) {
                 throw error;
            }
            throw new Error(`Erro ao chamar a API de IA: ${error.message}`);
        }
        throw new Error("Ocorreu um erro desconhecido ao se comunicar com a IA.");
    }
}

const getToneInstruction = (formality: string): string => {
    switch (formality) {
        case 'descontraido':
            return "Use um tom de voz alegre e descontraído, ideal para redes sociais.";
        case 'formal':
            return "Use um tom de voz formal e técnico, focado em especificações.";
        case 'profissional':
        default:
            return "Use um tom de voz vendedor e profissional, equilibrado e direto.";
    }
};

export async function generateProductDescription(base64Image: string, mimeType: string, userProductInfo: string, formality: string): Promise<string> {
    try {
        const imagePart = {
            inlineData: {
                data: getRawBase64(base64Image),
                mimeType: mimeType,
            },
        };

        const toneInstruction = getToneInstruction(formality);
        let promptText = "";

        if (userProductInfo.trim()) {
            promptText = `Baseado na imagem e na descrição fornecida pelo usuário, crie uma descrição de produto otimizada para marketplace.
    
            Descrição do usuário: "${userProductInfo}"

            Instrução de Tom: ${toneInstruction}
            
            Sua tarefa é expandir a descrição do usuário, incorporando detalhes visuais da imagem e usando uma linguagem vendedora e profissional. A descrição final deve ter no máximo dois parágrafos e destacar os principais benefícios e características do produto.`;
        } else {
            promptText = `Analise a imagem deste produto e escreva uma descrição concisa e atrativa para um marketplace.

            Instrução de Tom: ${toneInstruction}
            
            A descrição deve ter no máximo dois parágagos e focar nos principais atributos e benefícios do produto visíveis na imagem. O tom deve ser vendedor e profissional.`;
        }

        const textPart = {
            text: promptText,
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });

        return response.text;

    } catch (error) {
        console.error("Erro ao chamar a API Gemini para descrição:", error);
        throw new Error("Falha ao gerar a descrição do produto.");
    }
}

export async function enhanceProductDescription(currentDescription: string): Promise<string> {
    try {
        const prompt = `Aprimore a seguinte descrição de produto para um marketplace. 
        Torne-a mais vendedora, profissional e otimizada para SEO, destacando os benefícios.
        Mantenha o tom original mas melhore a clareza e o impacto. Não adicione informações 
        que não possam ser inferidas. A descrição deve ter no máximo dois parágrafos.\n\nDescrição Original:\n"${currentDescription}"`;

        // FIX: For text-only prompts, pass the string directly to the 'contents' property.
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        return response.text;
    } catch (error) {
        console.error("Erro ao aprimorar descrição com API Gemini:", error);
        throw new Error("Falha ao aprimorar a descrição do produto.");
    }
}