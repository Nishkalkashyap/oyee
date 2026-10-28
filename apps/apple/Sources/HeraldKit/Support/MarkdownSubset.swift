import Foundation

/// Renderer for Herald's markdown subset: `**bold**`, `*italic*`, `` `code` ``, `[link](url)` and line breaks.
///
/// Everything else (headings, lists, images, raw HTML, …) is shown as literal text. Only `http`, `https` and
/// `mailto` links become clickable. Backslash escapes (`\*`) are supported.
public enum MarkdownSubset {
    public struct Run: Sendable, Hashable {
        public var text: String
        public var bold = false
        public var italic = false
        public var code = false
        public var link: URL?

        public init(text: String, bold: Bool = false, italic: Bool = false, code: Bool = false, link: URL? = nil) {
            self.text = text
            self.bold = bold
            self.italic = italic
            self.code = code
            self.link = link
        }

        func sameStyle(as other: Run) -> Bool {
            bold == other.bold && italic == other.italic && code == other.code && link == other.link
        }
    }

    private struct Style {
        var bold = false
        var italic = false
        var link: URL?
    }

    private static let escapable: Set<Character> = ["\\", "`", "*", "_", "[", "]", "(", ")", "#", "<", ">"]
    private static let allowedSchemes: Set<String> = ["http", "https", "mailto"]

    /// Parses the input into styled runs (adjacent runs with the same style are merged).
    public static func parse(_ input: String) -> [Run] {
        let chars = Array(input.replacingOccurrences(of: "\r\n", with: "\n"))
        var runs: [Run] = []
        parse(chars, chars.startIndex, chars.endIndex, Style(), into: &runs)
        // Merge adjacent runs with identical styles.
        var merged: [Run] = []
        for run in runs where !run.text.isEmpty {
            if let last = merged.last, last.sameStyle(as: run) {
                merged[merged.count - 1].text += run.text
            } else {
                merged.append(run)
            }
        }
        return merged
    }

    /// The text without markdown markers (for system notifications, which can't render styles).
    public static func plainText(_ input: String) -> String {
        parse(input).map(\.text).joined()
    }

    /// An `AttributedString` using inline presentation intents and links (rendered natively by SwiftUI `Text`).
    public static func attributed(_ input: String) -> AttributedString {
        var result = AttributedString()
        for run in parse(input) {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if run.code { intent.insert(.code) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let link = run.link { piece.link = link }
            result += piece
        }
        return result
    }

    // MARK: - Parser

    private static func parse(_ c: [Character], _ start: Int, _ end: Int, _ style: Style, into runs: inout [Run]) {
        var buffer = ""
        func flush() {
            guard !buffer.isEmpty else { return }
            runs.append(Run(text: buffer, bold: style.bold, italic: style.italic, link: style.link))
            buffer = ""
        }

        var i = start
        while i < end {
            let ch = c[i]

            // Backslash escape.
            if ch == "\\", i + 1 < end, escapable.contains(c[i + 1]) {
                buffer.append(c[i + 1])
                i += 2
                continue
            }

            // Inline code: no formatting inside.
            if ch == "`", let close = find("`", in: c, from: i + 1, to: end), close > i + 1 {
                flush()
                runs.append(
                    Run(
                        text: String(c[(i + 1)..<close]), bold: style.bold, italic: style.italic, code: true,
                        link: style.link))
                i = close + 1
                continue
            }

            // Bold: **text**
            if ch == "*", i + 1 < end, c[i + 1] == "*", !style.bold,
               i + 2 < end, !c[i + 2].isWhitespace,
               let close = findDoubleStar(in: c, from: i + 2, to: end) {
                flush()
                var inner = style
                inner.bold = true
                parse(c, i + 2, close, inner, into: &runs)
                i = close + 2
                continue
            }

            // Italic: *text*
            if ch == "*", !style.italic, i + 1 < end, !c[i + 1].isWhitespace, c[i + 1] != "*",
               let close = findSingleStar(in: c, from: i + 1, to: end) {
                flush()
                var inner = style
                inner.italic = true
                parse(c, i + 1, close, inner, into: &runs)
                i = close + 1
                continue
            }

            // Link: [text](url)
            if ch == "[", style.link == nil, let link = parseLink(c, from: i, to: end) {
                flush()
                var inner = style
                inner.link = link.url
                parse(c, i + 1, link.textEnd, inner, into: &runs)
                i = link.next
                continue
            }

            buffer.append(ch)
            i += 1
        }
        flush()
    }

    private static func find(_ target: Character, in c: [Character], from: Int, to end: Int) -> Int? {
        var j = from
        while j < end {
            if c[j] == target { return j }
            j += 1
        }
        return nil
    }

    /// Finds a closing `**` that is preceded by a non-space character.
    private static func findDoubleStar(in c: [Character], from: Int, to end: Int) -> Int? {
        var j = from
        while j + 1 < end {
            if c[j] == "\\" { j += 2; continue }
            if c[j] == "`", let close = find("`", in: c, from: j + 1, to: end) { j = close + 1; continue }
            if c[j] == "*", c[j + 1] == "*", j > from, !c[j - 1].isWhitespace {
                // `***` closing `**bold *italic***`: if the inner text has an unmatched `*`, close one later so the
                // italic span gets its closing star.
                if j + 2 < end, c[j + 2] == "*", unmatchedSingleStar(in: c, from: from, to: j) { return j + 1 }
                return j
            }
            j += 1
        }
        return nil
    }

    private static func unmatchedSingleStar(in c: [Character], from: Int, to end: Int) -> Bool {
        var count = 0
        var j = from
        while j < end {
            if c[j] == "\\" { j += 2; continue }
            if c[j] == "*" {
                if j + 1 < end, c[j + 1] == "*" { j += 2; continue }
                count += 1
            }
            j += 1
        }
        return count % 2 == 1
    }

    /// Finds a closing single `*` preceded by a non-space character, skipping over `**` pairs.
    private static func findSingleStar(in c: [Character], from: Int, to end: Int) -> Int? {
        var j = from
        while j < end {
            if c[j] == "\\" { j += 2; continue }
            if c[j] == "`", let close = find("`", in: c, from: j + 1, to: end) { j = close + 1; continue }
            if c[j] == "*" {
                if j + 1 < end, c[j + 1] == "*" {
                    // Skip a nested **bold** span entirely.
                    if let close = findDoubleStar(in: c, from: j + 2, to: end) { j = close + 2; continue }
                    j += 2
                    continue
                }
                if j > from, !c[j - 1].isWhitespace { return j }
            }
            j += 1
        }
        return nil
    }

    private static func parseLink(_ c: [Character], from start: Int, to end: Int) -> (url: URL, textEnd: Int, next: Int)? {
        // Find the matching "]" (no nesting of brackets).
        guard let closeBracket = find("]", in: c, from: start + 1, to: end), closeBracket > start + 1,
              closeBracket + 1 < end, c[closeBracket + 1] == "(",
              let closeParen = find(")", in: c, from: closeBracket + 2, to: end)
        else { return nil }
        let raw = String(c[(closeBracket + 2)..<closeParen]).trimmingCharacters(in: .whitespaces)
        guard !raw.contains(" "), let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              allowedSchemes.contains(scheme)
        else { return nil }
        return (url, closeBracket, closeParen + 1)
    }
}
