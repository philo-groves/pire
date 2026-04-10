import SwiftUI
import AVFoundation

/// Camera-based QR code scanner.
struct QRScannerView: UIViewControllerRepresentable {
    var onScanned: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> ScannerViewController {
        let vc = ScannerViewController()
        vc.onScanned = { code in
            onScanned(code)
        }
        return vc
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}

    class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onScanned: ((String) -> Void)?
        private var captureSession: AVCaptureSession?
        private var previewLayer: AVCaptureVideoPreviewLayer?
        private var hasScanned = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black

            let session = AVCaptureSession()
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else {
                showError("Camera not available")
                return
            }
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                showError("Cannot process QR codes")
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]

            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.bounds
            view.layer.addSublayer(preview)
            self.previewLayer = preview
            self.captureSession = session

            // Add instruction overlay
            let label = UILabel()
            label.text = "Point camera at pimote QR code"
            label.textColor = .white
            label.font = .systemFont(ofSize: 16, weight: .medium)
            label.textAlignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([
                label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
                label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            ])

            DispatchQueue.global(qos: .userInitiated).async {
                session.startRunning()
            }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            previewLayer?.frame = view.bounds
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            captureSession?.stopRunning()
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !hasScanned,
                  let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  let value = object.stringValue,
                  value.contains("trycloudflare.com") || value.contains("://") else { return }

            hasScanned = true
            AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
            captureSession?.stopRunning()
            onScanned?(value)
        }

        private func showError(_ message: String) {
            let label = UILabel()
            label.text = message
            label.textColor = .white
            label.textAlignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            ])
        }
    }
}
