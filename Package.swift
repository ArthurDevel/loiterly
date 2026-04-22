// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MemphisCursor",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "MemphisCursor", targets: ["MemphisCursor"]),
    ],
    targets: [
        .executableTarget(
            name: "MemphisCursor"
        ),
    ]
)
