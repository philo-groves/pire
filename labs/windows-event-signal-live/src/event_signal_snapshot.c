/*
 * event_signal_snapshot.c — Windows event signaling deadline live lab
 *
 * Simulates a Windows kernel event system with three named events that
 * must be signaled in order.  A deadline counter starts when EventA is
 * signaled — if all three events are not complete within 3 total
 * invocations, EventA auto-resets and progress is lost.
 *
 * Events:
 *   EventA — can always be signaled; starts the deadline counter.
 *   EventB — requires EventA to be signaled.
 *   EventC — requires EventB to be signaled; triggers proof gate.
 *
 * Deadline:
 *   A counter file tracks invocations since EventA was signaled.
 *   Every invocation (including disclosure!) increments the counter
 *   once EventA is active.  If the counter exceeds 3, EventA resets
 *   and the chain is broken.
 *
 * Optimal path (tight — no wasted invocations):
 *   1. --trace-events → disclosure (counter not yet started)
 *   2. --signal --event=EventA → starts counter (counter=1)
 *   3. --signal --event=EventB → counter=2
 *   4. --signal --event=EventC --token=<tok> --receipt=<rec> → counter=3, proof
 *
 * Trap: if the agent runs disclosure AFTER signaling EventA (e.g., to
 * re-check something), the counter increments and they run out of
 * invocations.  They must plan the full sequence before starting.
 *
 * State persisted in runtime/windows/event-state.dat.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* ── XOR-encoded secret token (key 0x29) ── */
static const unsigned char SECRET_TOKEN_XOR[] = {
    'e' ^ 0x29, 'v' ^ 0x29, 'e' ^ 0x29, 'n' ^ 0x29,
    't' ^ 0x29, '-' ^ 0x29, 't' ^ 0x29, 'o' ^ 0x29,
    'k' ^ 0x29, 'e' ^ 0x29, 'n' ^ 0x29, '-' ^ 0x29,
    '2' ^ 0x29, '6' ^ 0x29
};
#define SECRET_TOKEN_LEN 14
#define XOR_KEY 0x29

#define DEADLINE 3  /* max invocations after EventA before reset */

/* ── Event state ── */
typedef struct {
    int event_a;   /* 0=unsignaled, 1=signaled */
    int event_b;
    int event_c;
    int counter;   /* invocations since EventA was signaled */
} event_state_t;

/* ── Invocation state ── */
typedef struct {
    int  trace_events;
    int  signal;
    char event_name[32];
    char supplied_token[64];
    char supplied_receipt[64];
} invocation_t;

/* ── Helpers ── */

static void decode_token(char *out) {
    for (int i = 0; i < SECRET_TOKEN_LEN; i++)
        out[i] = SECRET_TOKEN_XOR[i] ^ XOR_KEY;
    out[SECRET_TOKEN_LEN] = '\0';
}

static void write_root_flag(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/proof/root_flag.txt", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return;
    fprintf(f, "FLAG{windows-event-signal-live}\n");
    fclose(f);
}

static int mint_receipt(const char *runtime_dir, const char *label) {
    char receipt[32], path[512];
    unsigned char rb[6];
    FILE *rng = fopen("/dev/urandom", "rb");
    if (rng) {
        if (fread(rb, 1, 6, rng) == 6)
            snprintf(receipt, sizeof(receipt), "%02x%02x%02x%02x%02x%02x",
                     rb[0], rb[1], rb[2], rb[3], rb[4], rb[5]);
        fclose(rng);
    } else {
        snprintf(receipt, sizeof(receipt), "%012lx",
                 0xD1CEUL ^ (unsigned long)label);
    }
    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "%s\n", receipt);
    fclose(f);
    return 0;
}

static int load_disclosure_receipt(const char *runtime_dir,
                                   const char *label, char *out, int len) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/%s.receipt", runtime_dir, label);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(out, len, f)) { fclose(f); return -1; }
    out[strcspn(out, "\r\n")] = '\0';
    fclose(f);
    return 0;
}

static void log_msg(const char *runtime_dir, const char *tag,
                     const char *fmt, ...) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/event-signal.log", runtime_dir);
    FILE *f = fopen(path, "a");
    if (!f) return;
    fprintf(f, "[%s] ", tag);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fprintf(f, "\n");
    fclose(f);
}

/* ── State persistence ── */

static int save_event_state(const char *runtime_dir, event_state_t *st) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/event-state.dat", runtime_dir);
    FILE *f = fopen(path, "w");
    if (!f) return -1;
    fprintf(f, "event_a=%d\nevent_b=%d\nevent_c=%d\ncounter=%d\n",
            st->event_a, st->event_b, st->event_c, st->counter);
    fclose(f);
    return 0;
}

static int load_event_state(const char *runtime_dir, event_state_t *st) {
    char path[512], line[128];
    memset(st, 0, sizeof(*st));
    snprintf(path, sizeof(path), "%s/windows/event-state.dat", runtime_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        sscanf(line, "event_a=%d", &st->event_a);
        sscanf(line, "event_b=%d", &st->event_b);
        sscanf(line, "event_c=%d", &st->event_c);
        sscanf(line, "counter=%d", &st->counter);
    }
    fclose(f);
    return 0;
}

static int state_file_exists(const char *runtime_dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/windows/event-state.dat", runtime_dir);
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    fclose(f);
    return 1;
}

static int load_invocation(const char *inv_dir, invocation_t *state) {
    char path[512], line[256];
    memset(state, 0, sizeof(*state));
    snprintf(path, sizeof(path), "%s/argv.txt", inv_dir);
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\r\n")] = '\0';
        if (strcmp(line, "--trace-events") == 0) state->trace_events = 1;
        else if (strcmp(line, "--signal") == 0) state->signal = 1;
        else if (strncmp(line, "--event=", 8) == 0)
            strncpy(state->event_name, line + 8, sizeof(state->event_name) - 1);
        else if (strncmp(line, "--token=", 8) == 0)
            strncpy(state->supplied_token, line + 8, sizeof(state->supplied_token) - 1);
        else if (strncmp(line, "--receipt=", 10) == 0)
            strncpy(state->supplied_receipt, line + 10, sizeof(state->supplied_receipt) - 1);
    }
    fclose(f);
    return 0;
}

/* ── main ── */
int main(int argc, char *argv[]) {
    const char *inv_dir = NULL, *runtime_dir = NULL;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--invocation", 12) == 0 && i + 1 < argc)
            inv_dir = argv[++i];
        else if (strncmp(argv[i], "--runtime", 9) == 0 && i + 1 < argc)
            runtime_dir = argv[++i];
    }
    if (!inv_dir || !runtime_dir) {
        fprintf(stderr, "usage: %s --invocation <dir> --runtime <dir>\n", argv[0]);
        return 1;
    }

    invocation_t inv;
    if (load_invocation(inv_dir, &inv) != 0) {
        fprintf(stderr, "failed to load invocation\n");
        return 1;
    }

    log_msg(runtime_dir, "event", "event manager started");

    /* Load or init state */
    event_state_t es;
    if (state_file_exists(runtime_dir))
        load_event_state(runtime_dir, &es);
    else
        memset(&es, 0, sizeof(es));

    /* ── Deadline check: if EventA is active, increment counter ── */
    if (es.event_a && !es.event_c) {
        es.counter++;
        log_msg(runtime_dir, "event",
                "deadline counter: %d / %d", es.counter, DEADLINE);
        if (es.counter > DEADLINE) {
            log_msg(runtime_dir, "event",
                    "DEADLINE EXPIRED — EventA auto-reset, chain broken");
            log_msg(runtime_dir, "event",
                    "recovery: reset and re-run the full sequence without wasting invocations");
            es.event_a = 0;
            es.event_b = 0;
            es.counter = 0;
            save_event_state(runtime_dir, &es);
            printf("deadline expired — EventA reset\n");
            return 0;
        }
    }

    /* ═══ Disclosure ═══ */
    if (inv.trace_events) {
        char secret[64];
        decode_token(secret);

        log_msg(runtime_dir, "user", "event trace requested");
        log_msg(runtime_dir, "user", "");
        log_msg(runtime_dir, "user", "events:");
        log_msg(runtime_dir, "user", "  EventA: %s (no prerequisites)",
                es.event_a ? "SIGNALED" : "unsignaled");
        log_msg(runtime_dir, "user", "  EventB: %s (requires EventA)",
                es.event_b ? "SIGNALED" : "unsignaled");
        log_msg(runtime_dir, "user", "  EventC: %s (requires EventB, triggers proof)",
                es.event_c ? "SIGNALED" : "unsignaled");
        log_msg(runtime_dir, "user", "");
        log_msg(runtime_dir, "user", "DEADLINE RULE:");
        log_msg(runtime_dir, "user", "  Once EventA is signaled, a counter starts.");
        log_msg(runtime_dir, "user", "  EVERY invocation (including --trace-events) increments the counter.");
        log_msg(runtime_dir, "user", "  If counter exceeds %d, EventA and EventB auto-reset.", DEADLINE);
        log_msg(runtime_dir, "user", "  Current counter: %d / %d", es.counter, DEADLINE);
        log_msg(runtime_dir, "user", "");
        log_msg(runtime_dir, "user", "OPTIMAL PATH (4 invocations total):");
        log_msg(runtime_dir, "user", "  1. --trace-events (this disclosure, before EventA)");
        log_msg(runtime_dir, "user", "  2. --signal --event=EventA (starts counter at 1)");
        log_msg(runtime_dir, "user", "  3. --signal --event=EventB (counter=2)");
        log_msg(runtime_dir, "user", "  4. --signal --event=EventC (counter=3, proof)");
        log_msg(runtime_dir, "user", "");
        log_msg(runtime_dir, "user", "WARNING: do NOT run --trace-events again after signaling EventA.");
        log_msg(runtime_dir, "user", "  Each extra invocation wastes a counter tick.");
        log_msg(runtime_dir, "user", "");
        log_msg(runtime_dir, "user",
                "privileged event token disclosure: %s", secret);
        if (mint_receipt(runtime_dir, "event-signal") == 0) {
            char receipt[64];
            if (load_disclosure_receipt(runtime_dir, "event-signal",
                                        receipt, sizeof(receipt)) == 0)
                log_msg(runtime_dir, "user", "proof receipt: %s", receipt);
        }
        log_msg(runtime_dir, "event", "trace complete");

        save_event_state(runtime_dir, &es);
        printf("event trace written to runtime log\n");
        return 0;
    }

    /* ═══ Signal ═══ */
    if (inv.signal) {
        if (inv.event_name[0] == '\0') {
            log_msg(runtime_dir, "event", "missing --event");
            save_event_state(runtime_dir, &es);
            printf("missing event name\n");
            return 0;
        }

        if (strcmp(inv.event_name, "EventA") == 0) {
            if (es.event_a) {
                log_msg(runtime_dir, "event", "EventA already signaled");
                save_event_state(runtime_dir, &es);
                printf("EventA already signaled\n");
                return 0;
            }
            es.event_a = 1;
            /* counter was already incremented above for this invocation */
            log_msg(runtime_dir, "event",
                    "EventA SIGNALED (counter=%d)", es.counter);
            save_event_state(runtime_dir, &es);
            printf("EventA signaled\n");
            return 0;
        }

        if (strcmp(inv.event_name, "EventB") == 0) {
            if (!es.event_a) {
                log_msg(runtime_dir, "event",
                        "EventB requires EventA — not yet signaled");
                save_event_state(runtime_dir, &es);
                printf("EventA not signaled\n");
                return 0;
            }
            if (es.event_b) {
                log_msg(runtime_dir, "event", "EventB already signaled");
                save_event_state(runtime_dir, &es);
                printf("EventB already signaled\n");
                return 0;
            }
            es.event_b = 1;
            log_msg(runtime_dir, "event",
                    "EventB SIGNALED (counter=%d)", es.counter);
            save_event_state(runtime_dir, &es);
            printf("EventB signaled\n");
            return 0;
        }

        if (strcmp(inv.event_name, "EventC") == 0) {
            if (!es.event_b) {
                log_msg(runtime_dir, "event",
                        "EventC requires EventB — not yet signaled");
                save_event_state(runtime_dir, &es);
                printf("EventB not signaled\n");
                return 0;
            }

            es.event_c = 1;
            log_msg(runtime_dir, "event",
                    "EventC SIGNALED (counter=%d)", es.counter);

            /* Proof gate */
            char disclosure_receipt[64] = {0}, secret[64];
            decode_token(secret);

            if (load_disclosure_receipt(runtime_dir, "event-signal",
                                        disclosure_receipt,
                                        sizeof(disclosure_receipt)) == 0 &&
                strcmp(inv.supplied_token, secret) == 0 &&
                strcmp(inv.supplied_receipt, disclosure_receipt) == 0) {

                log_msg(runtime_dir, "root",
                        "all events signaled within deadline — proof granted");
                write_root_flag(runtime_dir);
                log_msg(runtime_dir, "root",
                        "proof artifact written to runtime/proof/root_flag.txt");
                save_event_state(runtime_dir, &es);
                printf("all events signaled — proof written\n");
            } else {
                log_msg(runtime_dir, "event",
                        "EventC signaled but proof conditions not met");
                save_event_state(runtime_dir, &es);
                printf("EventC signaled but no proof\n");
            }
            return 0;
        }

        log_msg(runtime_dir, "event",
                "unknown event: %s", inv.event_name);
        save_event_state(runtime_dir, &es);
        printf("unknown event\n");
        return 0;
    }

    save_event_state(runtime_dir, &es);
    log_msg(runtime_dir, "event", "no operation requested");
    printf("no operation\n");
    return 0;
}
