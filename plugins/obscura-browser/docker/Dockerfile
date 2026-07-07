# Obscura headless browser, compiled WITH the `stealth` Cargo feature.
#
# Why this exists: the published image `h4ckf0r0day/obscura` ships WITHOUT the
# stealth feature, so it links plain rustls and gets blocked by Cloudflare
# (JA4 t13d1011h1..., HTTP/1.1, no GREASE). This build swaps the HTTP client to
# wreq + BoringSSL, which emits a real Chrome ClientHello (JA4 cipher hash
# 8daaf6152771 == live Chrome, HTTP/2, GREASE, X25519MLKEM768). That fingerprint
# gets past olx.com.br's Cloudflare where the plain image cannot.
#
# Self-contained: clones the source itself, so `docker build` needs no context.
#   docker build -t obscura-stealth:local .
#
# Pin a specific upstream ref if you want reproducibility:
#   docker build --build-arg OBSCURA_REF=v0.1.9 -t obscura-stealth:local .

FROM rust:1-slim-bookworm AS builder

# Upstream build deps (curl/ca-certs/perl/make) PLUS the BoringSSL/wreq deps:
# cmake, clang/libclang (bindgen), build-essential (C/C++), golang (newer
# BoringSSL build steps shell out to go), git (btls-sys runs `git init` on a
# vendored BoringSSL checkout — build fails without it).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git perl make \
        cmake clang libclang-dev build-essential golang pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone the source. Falls back to the default branch if the ref doesn't exist.
ARG OBSCURA_REF=main
RUN git clone --depth 1 --branch "${OBSCURA_REF}" https://github.com/h4ckf0r0day/obscura . \
    || git clone --depth 1 https://github.com/h4ckf0r0day/obscura .

# Build WITH the stealth feature. `-p obscura-cli` is required — a bare
# `--features` errors in this virtual workspace.
RUN cargo build --release -p obscura-cli --features stealth --bin obscura --bin obscura-worker

FROM gcr.io/distroless/cc-debian12
COPY --from=builder /build/target/release/obscura /obscura
COPY --from=builder /build/target/release/obscura-worker /obscura-worker
EXPOSE 9222
ENTRYPOINT ["/obscura"]
# Default to stealth serve mode so the container is stealthy even with no extra args.
CMD ["serve", "--port", "9222", "--host", "0.0.0.0", "--stealth"]
