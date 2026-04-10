/**
 * Print a QR code to the terminal.
 */

export async function printQrCode(text: string): Promise<void> {
	try {
		const qrcode = (await import("qrcode-terminal" as string)) as {
			generate(text: string, options: { small: boolean }, callback: (code: string) => void): void;
		};
		return new Promise<void>((resolve) => {
			qrcode.generate(text, { small: true }, (code: string) => {
				console.log(code);
				resolve();
			});
		});
	} catch {
		console.log(`(QR code unavailable — install qrcode-terminal for QR display)`);
	}
}
