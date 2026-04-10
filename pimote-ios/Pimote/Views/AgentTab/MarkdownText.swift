import SwiftUI

/// Renders markdown text with monospace font, bold, italics, inline code,
/// code blocks, and clickable URLs.
struct MarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(parsedAttributedString)
            .font(.system(size: 13, design: .monospaced))
            .textSelection(.enabled)
            .tint(.accentColor)
    }

    private var parsedAttributedString: AttributedString {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var result = AttributedString()
        var inCodeBlock = false
        var codeBlockLines: [String] = []
        var isFirst = true

        for line in lines {
            // Code block fences
            if line.hasPrefix("```") {
                if inCodeBlock {
                    // End code block
                    if !isFirst { result.append(newline()) }
                    result.append(codeBlock(codeBlockLines.joined(separator: "\n")))
                    codeBlockLines = []
                    inCodeBlock = false
                    isFirst = false
                } else {
                    inCodeBlock = true
                    codeBlockLines = []
                }
                continue
            }

            if inCodeBlock {
                codeBlockLines.append(line)
                continue
            }

            if !isFirst {
                result.append(newline())
            }

            // Headings: # ## ### → bold
            let trimmed = line.drop(while: { $0 == "#" })
            let hashCount = line.count - trimmed.count
            if hashCount > 0 && hashCount <= 6 && trimmed.first == " " {
                result.append(boldText(String(trimmed.dropFirst())))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                var bullet = AttributedString("  \u{2022} ")
                bullet.font = .system(size: 13, design: .monospaced)
                result.append(bullet)
                result.append(parseInline(String(line.dropFirst(2))))
            } else {
                result.append(parseInline(line))
            }
            isFirst = false
        }

        // Unclosed code block
        if inCodeBlock && !codeBlockLines.isEmpty {
            if !isFirst { result.append(newline()) }
            result.append(codeBlock(codeBlockLines.joined(separator: "\n")))
        }

        return result
    }

    // MARK: - Inline parsing

    /// Parse inline markdown: **bold**, *italic*, `code`, [text](url), bare URLs
    private func parseInline(_ text: String) -> AttributedString {
        var result = AttributedString()
        let chars = Array(text)
        var i = 0

        while i < chars.count {
            // Inline code: `...`
            if chars[i] == "`" {
                if let end = findClosing(chars, from: i + 1, char: "`") {
                    let code = String(chars[(i + 1)..<end])
                    result.append(inlineCode(code))
                    i = end + 1
                    continue
                }
            }

            // Bold: **...**
            if i + 1 < chars.count && chars[i] == "*" && chars[i + 1] == "*" {
                if let end = findDoubleClosing(chars, from: i + 2, char: "*") {
                    let content = String(chars[(i + 2)..<end])
                    result.append(boldText(content))
                    i = end + 2
                    continue
                }
            }

            // Italic: *...*
            if chars[i] == "*" && (i + 1 < chars.count && chars[i + 1] != "*" && chars[i + 1] != " ") {
                if let end = findClosing(chars, from: i + 1, char: "*") {
                    let content = String(chars[(i + 1)..<end])
                    result.append(italicText(content))
                    i = end + 1
                    continue
                }
            }

            // Markdown link: [text](url)
            if chars[i] == "[" {
                if let (linkText, url, endIdx) = parseMarkdownLink(chars, from: i) {
                    result.append(linkAttributed(linkText, url: url))
                    i = endIdx
                    continue
                }
            }

            // Bare URL
            if chars[i] == "h" {
                let remaining = String(chars[i...])
                if remaining.hasPrefix("https://") || remaining.hasPrefix("http://") {
                    let length = parseBareURLLength(remaining)
                    if length > 8 {
                        let url = String(remaining.prefix(length))
                        result.append(linkAttributed(url, url: url))
                        i += length
                        continue
                    }
                }
            }

            // Plain character
            var plain = AttributedString(String(chars[i]))
            plain.font = .system(size: 13, design: .monospaced)
            result.append(plain)
            i += 1
        }

        return result
    }

    // MARK: - Styled fragments

    private func inlineCode(_ text: String) -> AttributedString {
        var s = AttributedString(" \(text) ")
        s.font = .system(size: 12, design: .monospaced).weight(.medium)
        s.foregroundColor = .orange
        s.backgroundColor = Color(white: 0.2)
        return s
    }

    private func codeBlock(_ text: String) -> AttributedString {
        var s = AttributedString(" \(text) ")
        s.font = .system(size: 11, design: .monospaced)
        s.foregroundColor = .green
        s.backgroundColor = Color(white: 0.15)
        return s
    }

    private func boldText(_ text: String) -> AttributedString {
        var s = AttributedString(text)
        s.font = .system(size: 13, design: .monospaced).bold()
        return s
    }

    private func italicText(_ text: String) -> AttributedString {
        var s = AttributedString(text)
        s.font = .system(size: 13, design: .monospaced).italic()
        return s
    }

    private func linkAttributed(_ text: String, url: String) -> AttributedString {
        var s = AttributedString(text)
        s.font = .system(size: 13, design: .monospaced)
        if let u = URL(string: url) {
            s.link = u
        }
        s.foregroundColor = .accentColor
        s.underlineStyle = .single
        return s
    }

    private func newline() -> AttributedString {
        AttributedString("\n")
    }

    // MARK: - Parsing helpers

    private func findClosing(_ chars: [Character], from start: Int, char: Character) -> Int? {
        for j in start..<chars.count {
            if chars[j] == char { return j }
        }
        return nil
    }

    private func findDoubleClosing(_ chars: [Character], from start: Int, char: Character) -> Int? {
        var j = start
        while j + 1 < chars.count {
            if chars[j] == char && chars[j + 1] == char { return j }
            j += 1
        }
        return nil
    }

    private func parseMarkdownLink(_ chars: [Character], from start: Int) -> (text: String, url: String, endIndex: Int)? {
        guard chars[start] == "[" else { return nil }
        guard let closeBracket = findClosing(chars, from: start + 1, char: "]") else { return nil }
        guard closeBracket + 1 < chars.count && chars[closeBracket + 1] == "(" else { return nil }
        guard let closeParen = findClosing(chars, from: closeBracket + 2, char: ")") else { return nil }
        let text = String(chars[(start + 1)..<closeBracket])
        let url = String(chars[(closeBracket + 2)..<closeParen])
        return (text, url, closeParen + 1)
    }

    private func parseBareURLLength(_ text: String) -> Int {
        let terminators: Set<Character> = [" ", "\t", "\n", "\r", ")", "]", ",", "\"", "'", ">"]
        var count = 0
        for char in text {
            if terminators.contains(char) { break }
            count += 1
        }
        // Strip trailing punctuation
        while count > 0 {
            let last = text[text.index(text.startIndex, offsetBy: count - 1)]
            if last == "." || last == "," || last == ";" { count -= 1 }
            else { break }
        }
        return count
    }
}
