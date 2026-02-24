import { useState } from 'react';
import { useBoothStore } from '@/store/booth-store';
import { usePrintStore } from '@/store/print-store';
import { useTenantStore } from '@/store/tenant-store';

export function usePrintHandler(compositeImage: string | null) {
    const [isPrinting, setIsPrinting] = useState(false);
    const { session } = useBoothStore();
    const { addJob } = usePrintStore();
    const { booth } = useTenantStore();

    const printCopiesCount = booth?.print_copies ?? 1;

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

                for (let i = 0; i < printCopiesCount; i++) {
                    await invoke('print_photo', {
                        imageData: compositeImage,
                        printerName: null // Use default printer
                    });
                }
                usedTauri = true;
                console.log(`Printed ${printCopiesCount} copies via Tauri`);
                addJob({
                    imageUrl: compositeImage,
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
                        `<div class="page-break"><img src="${compositeImage}" /></div>`
                    ).join('');

                    printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>ChronoSnap Print</title>
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
                        imageUrl: compositeImage,
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
