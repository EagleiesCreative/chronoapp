import { useState } from 'react';
import { useBoothStore } from '@/store/booth-store';
import { usePrintStore } from '@/store/print-store';
import { useTenantStore } from '@/store/tenant-store';

export function usePrintHandler(compositeImage: string | null) {
    const [isPrinting, setIsPrinting] = useState(false);
    const { session, printImage } = useBoothStore();
    const { addJob } = usePrintStore();
    const { booth } = useTenantStore();

    const printCopiesCount = booth?.print_copies ?? 1;
    // Use printImage (always 4R) for printing, fall back to compositeImage
    const imageForPrint = printImage || compositeImage;

    const handlePrint = async (onPrintInitiated?: () => void) => {
        if (!compositeImage) return;

        if (onPrintInitiated) {
            onPrintInitiated();
        }

        setIsPrinting(true);

        try {
            // Try to use Tauri print command
            let usedTauri = false;
            try {
                const { invoke } = await import('@tauri-apps/api/core');

                const pageSize = booth?.booth_type === 'A3_NEWSPAPER' ? 'A3' : '4R';

                for (let i = 0; i < printCopiesCount; i++) {
                    await invoke('print_photo', {
                        imageData: imageForPrint,
                        printerName: null, // Use default printer
                        pageSize: pageSize
                    });
                }
                usedTauri = true;
                console.log(`Printed ${printCopiesCount} copies via Tauri`);
                addJob({
                    imageUrl: imageForPrint!,
                    copies: printCopiesCount,
                    status: 'success',
                    session_id: session?.id
                });
            } catch (tauriErr) {
                console.log('Tauri not available, using browser print:', tauriErr);
            }

            // Fallback to browser print
            if (!usedTauri) {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                    const imagesHtml = Array(printCopiesCount).fill(0).map(() =>
                        `<div class="page-break"><img src="${imageForPrint}" /></div>`
                    ).join('');

                    printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Framr Studio Print</title>
                <style>
                  body { margin: 0; background: white; }
                  .page-break { 
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      min-height: 100vh;
                      page-break-after: always;
                  }
                  .page-break:last-child { page-break-after: auto; }
                  img { max-width: 100%; height: auto; }
                  @media print {
                    body { margin: 0; }
                    img { width: 100%; }
                  }
                </style>
              </head>
              <body>
                ${imagesHtml}
                <script>
                    window.onload = () => {
                        setTimeout(() => {
                            window.print();
                            window.close();
                        }, 500);
                    };
                </script>
              </body>
            </html>
          `);
                    printWindow.document.close();
                    addJob({
                        imageUrl: imageForPrint!,
                        copies: printCopiesCount,
                        status: 'success',
                        session_id: session?.id
                    });
                }
            }
        } catch (err: any) {
            console.error('Print error:', err);
            addJob({
                imageUrl: compositeImage,
                copies: printCopiesCount,
                status: 'failed',
                session_id: session?.id,
                error: err.message || 'Unknown error'
            });
        } finally {
            setIsPrinting(false);
        }
    };

    return { isPrinting, handlePrint, printCopiesCount };
}
