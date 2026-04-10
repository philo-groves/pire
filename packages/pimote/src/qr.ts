/**
 * Print a QR code to the terminal.
 */

export async function printQrCode(text: string): Promise<void> {
	try {
		const mod = await import("qrcode-terminal" as string);
		const qrcode = mod.default ?? mod;
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
