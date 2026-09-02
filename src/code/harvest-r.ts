// The R side of the code element, as strings node can test: the package
// pre-scan, the one-time boot script, and the run wrapper. The wrapper
// evaluates the user's script with console semantics, catches every
// condition IN R (so the TS side never handles R condition objects),
// serializes a trailing data frame in base R (strings only — no package
// needed for a script that just prints), serializes the data bridge through
// jsonlite (installed by webr.ts when paths are requested), and returns one
// character vector: c(error, stderr, table_json, data_json).
//
// Why a character vector and not R objects: RCharacter.toArray() is the
// whole boundary. Everything else stays R-side and purge-able.
//
// The R sources are String.raw so a backslash in the R is a backslash here.

export const R_TABLE_CAP = 30;
export const R_DATA_CAP_NUMBERS = 5000;
export const R_DATA_CAP_ROWS = 200;

/** ggplot2 sizes its text in points against a 72-dpi canvas; at the 2×
 *  canvas size webr.ts renders, an unbumped theme reads as fine print once
 *  the figure is fitted into the output pane. The hook runs when ggplot2
 *  loads, before any plot, and a script's own theme_set() still wins.
 *  The value is what the live smoke settled on (spec §5.4). */
export const GGPLOT_BASE_SIZE = 22;

/** Attached with R, or part of it — never something to fetch from the
 *  repo. `webr` is the runtime's own package. */
export const R_BASE_PACKAGES: ReadonlySet<string> = new Set([
  "base", "stats", "utils", "graphics", "grDevices", "methods", "datasets", "tools", "parallel",
  "compiler", "grid", "splines", "stats4", "tcltk", "webr",
]);

/** Package names a script names: library(x), require(x), requireNamespace("x")
 *  and x::fn. The shim installed at boot covers the first two on its own;
 *  the pre-scan exists for the others and so the status pill can say what is
 *  downloading. Comments are stripped first. Order of first mention. */
export function rPackagesIn(code: string): string[] {
  const src = code.replace(/#[^\n]*/g, "");
  const out: string[] = [];
  const add = (name: string) => {
    if (!R_BASE_PACKAGES.has(name) && !out.includes(name)) out.push(name);
  };
  const calls = /\b(?:library|require|requireNamespace)\(\s*["']?([A-Za-z][A-Za-z0-9.]*)["']?\s*[,)]/g;
  const colons = /\b([A-Za-z][A-Za-z0-9.]*)::/g;
  let m: RegExpExecArray | null;
  while ((m = calls.exec(src))) add(m[1]);
  while ((m = colons.exec(src))) add(m[1]);
  return out;
}

/** Runs once after webR.init(): library()/require() auto-install from the
 *  WebAssembly CRAN mirror, ggplot2 text scaled when it loads, a console
 *  width the output pane can hold. */
export const R_BOOT = String.raw`
webr::shim_install()
setHook(packageEvent("ggplot2", "onLoad"), function(...) {
  ggplot2::theme_set(ggplot2::theme_gray(base_size = ${GGPLOT_BASE_SIZE}))
})
options(width = 80)
`;

/** Reads .__code (the script) and .__paths (dotted paths joined by "\n", ""
 *  for none) from its evaluation environment. Console semantics: every
 *  top-level expression but the last prints when visible; the last goes
 *  through withVisible so a data frame becomes a table instead of text and
 *  an invisible value stays silent. Conditions are caught here: warnings
 *  and messages collect into the stderr string, an error into the error
 *  string with its call, exactly like R's own "Error in f(x): msg". */
export const R_WRAPPER = String.raw`
.__env <- new.env(parent = globalenv())
.__err <- ""
.__warn <- character(0)
.__table <- NULL
.__table_json <- ""
.__data_json <- ""
.__exprs <- tryCatch(parse(text = .__code, keep.source = FALSE),
  error = function(e) { .__err <<- paste0("Error: ", conditionMessage(e)); NULL })
.__run <- function() {
  n <- length(.__exprs)
  if (n > 1) withAutoprint(.__exprs[seq_len(n - 1)], evaluated = TRUE, echo = FALSE, local = .__env)
  if (n > 0) {
    last <- withVisible(eval(.__exprs[[n]], .__env))
    if (last$visible) {
      if (is.data.frame(last$value)) .__table <<- last$value else print(last$value)
    }
  }
}
if (!is.null(.__exprs)) withCallingHandlers(
  tryCatch(.__run(), error = function(e) {
    call <- conditionCall(e)
    callstr <- if (is.null(call)) "" else paste(deparse(call, nlines = 1), collapse = "")
    # A top-level stop() reports the wrapper's own eval() as its call; the
    # console would say plain "Error: msg", so drop our plumbing's calls.
    if (grepl("^(eval|withVisible|withAutoprint|source)\\(", callstr)) callstr <- ""
    .__err <<- if (callstr == "") paste0("Error: ", conditionMessage(e))
      else paste0("Error in ", callstr, ": ", conditionMessage(e))
  }),
  warning = function(w) { .__warn <<- c(.__warn, paste0("Warning: ", conditionMessage(w))); invokeRestart("muffleWarning") },
  message = function(m) {
    # library(dplyr)'s "Attaching package … masked from" banner is a
    # packageStartupMessage: console furniture, not the script's output —
    # muffled silently, so the output pane holds the result, not the banner.
    if (!inherits(m, "packageStartupMessage")) .__warn <<- c(.__warn, sub("\n$", "", conditionMessage(m)))
    invokeRestart("muffleMessage")
  }
)
.__jstr <- function(s) {
  s <- gsub("\\", "\\\\", s, fixed = TRUE)
  s <- gsub("\"", "\\\"", s, fixed = TRUE)
  s <- gsub("\n", "\\n", s, fixed = TRUE)
  s <- gsub("\r", "\\r", s, fixed = TRUE)
  s <- gsub("\t", "\\t", s, fixed = TRUE)
  paste0("\"", s, "\"")
}
.__cell <- function(col) {
  out <- if (is.numeric(col)) format(col, digits = getOption("digits"), trim = TRUE) else as.character(col)
  out[is.na(col)] <- ""
  out
}
if (.__err == "" && !is.null(.__table)) {
  t <- as.data.frame(.__table, stringsAsFactors = FALSE)
  cap <- ${R_TABLE_CAP}L
  n <- nrow(t)
  h <- if (n > cap) t[seq_len(cap), , drop = FALSE] else t
  cells <- lapply(h, .__cell)
  rows <- vapply(seq_len(nrow(h)), function(i)
    paste0("[", paste(vapply(cells, function(cv) .__jstr(cv[[i]]), ""), collapse = ","), "]"), "")
  .__table_json <- paste0("{\"columns\":[", paste(vapply(names(h), .__jstr, ""), collapse = ","),
    "],\"rows\":[", paste(rows, collapse = ","), "],\"truncated\":", max(0L, n - cap), "}")
}
.__paths <- if (nzchar(.__paths)) strsplit(.__paths, "\n", fixed = TRUE)[[1]] else character(0)
if (.__err == "" && length(.__paths) > 0) {
  .__CAP_N <- ${R_DATA_CAP_NUMBERS}L
  .__CAP_ROWS <- ${R_DATA_CAP_ROWS}L
  .__count <- function(x) {
    if (is.data.frame(x)) return(nrow(x) * max(1L, ncol(x)))
    if (is.list(x)) return(sum(vapply(x, .__count, 1)))
    length(x)
  }
  .__leaf <- function(x) jsonlite::unbox(x)
  .__plain <- function(v) {
    if (is.factor(v)) return(as.character(v))
    if (inherits(v, "Date") || inherits(v, "POSIXt")) return(as.character(v))
    v
  }
  .__conv <- function(v) {
    if (is.data.frame(v)) {
      if (nrow(v) > .__CAP_ROWS) stop(sprintf("%d rows, the cap is %d — aggregate or sample in the script", nrow(v), .__CAP_ROWS))
      v <- as.data.frame(v, stringsAsFactors = FALSE)
      cols <- lapply(v, .__plain)
      rows <- lapply(seq_len(nrow(v)), function(i) unname(lapply(cols, function(col) .__leaf(col[[i]]))))
      return(list(columns = names(v), rows = rows))
    }
    v <- .__plain(v)
    if (is.atomic(v)) {
      if (length(v) == 1L && is.null(names(v))) return(.__leaf(v))
      if (!is.null(names(v))) return(lapply(as.list(v), .__leaf))
      return(unname(lapply(as.list(v), .__leaf)))
    }
    if (is.list(v)) {
      out <- lapply(v, .__conv)
      return(if (is.null(names(v))) unname(out) else out)
    }
    stop(sprintf("%s is not data (a number, string, vector, list or data frame)", class(v)[1]))
  }
  .__walk <- function(obj, segs) {
    for (s in segs) {
      if ((is.data.frame(obj) || is.list(obj)) && !is.null(names(obj)) && s %in% names(obj)) obj <- obj[[s]]
      else stop(sprintf("no column or element %s", s))
    }
    obj
  }
  .__data <- list()
  .__errors <- list()
  for (p in .__paths) {
    res <- tryCatch({
      segs <- strsplit(p, ".", fixed = TRUE)[[1]]
      if (!exists(segs[1], envir = .__env, inherits = FALSE)) stop(sprintf("no variable %s", segs[1]))
      obj <- .__walk(get(segs[1], envir = .__env), segs[-1])
      n <- .__count(obj)
      if (n > .__CAP_N) stop(sprintf("%d values, the cap is %d — downsample or aggregate in the script", n, .__CAP_N))
      list(ok = TRUE, value = .__conv(obj))
    }, error = function(e) list(ok = FALSE, msg = conditionMessage(e)))
    if (res$ok) .__data[[p]] <- res$value else .__errors[[p]] <- jsonlite::unbox(res$msg)
  }
  .__data_json <- as.character(jsonlite::toJSON(list(data = .__data, errors = .__errors),
    auto_unbox = FALSE, na = "null", null = "null", digits = NA))
}
c(.__err, paste(.__warn, collapse = "\n"), .__table_json, .__data_json)
`;
