#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_ENTRIES 8
#define FLAG_CAN_MERGE 1

typedef struct CacheEntry {
	char data[32];
	int flags;
	int owner; /* 0=user, 1=root */
} CacheEntry;

typedef struct CacheState {
	CacheEntry entries[MAX_ENTRIES];
	char backing_store[16];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug;
} CacheState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'p' ^ 0x37, 'i' ^ 0x37, 'p' ^ 0x37, 'e' ^ 0x37, '-' ^ 0x37, 't' ^ 0x37,
	'o' ^ 0x37, 'k' ^ 0x37, 'e' ^ 0x37, 'n' ^ 0x37, '-' ^ 0x37, '2' ^ 0x37,
	'2' ^ 0x37,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x37);
	}
	output[index] = '\0';
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/cache/cache.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/cache/cache_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{dirty-pipe-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x2222UL);
	snprintf(path, sizeof(path), "%s/cache/cache.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/cache/cache.receipt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(receipt);
	return 0;
}

/* Allocate a cache entry with data and flags. */
static void alloc_entry(CacheState *state, int slot, const char *data, int flags) {
	if (slot < 0 || slot >= MAX_ENTRIES) {
		return;
	}
	snprintf(state->entries[slot].data, sizeof(state->entries[slot].data), "%s", data);
	state->entries[slot].flags = flags;
	state->entries[slot].owner = (flags & FLAG_CAN_MERGE) ? 1 : 0;
}

/*
 * Splice (zero-copy transfer) data from src to dst.
 * Copies data and flags from src entry to dst entry.
 * The destination is always user-owned after splice.
 */
static void splice_entry(CacheState *state, int src, int dst) {
	if (src < 0 || src >= MAX_ENTRIES || dst < 0 || dst >= MAX_ENTRIES) {
		return;
	}
	memcpy(state->entries[dst].data, state->entries[src].data, 32);
	/* Flags carry over from source — not cleared on destination. */
	state->entries[dst].flags = state->entries[src].flags;
	state->entries[dst].owner = 0;
}

/*
 * Write data to a cache entry.
 * If the entry has CAN_MERGE set, the write targets the
 * root-owned backing store instead of the entry's own buffer.
 */
static void write_entry(CacheState *state, int slot, const char *data) {
	if (slot < 0 || slot >= MAX_ENTRIES) {
		return;
	}
	if (state->entries[slot].flags & FLAG_CAN_MERGE) {
		snprintf(state->backing_store, sizeof(state->backing_store), "%s", data);
	} else {
		snprintf(state->entries[slot].data, sizeof(state->entries[slot].data), "%s", data);
	}
}

static int process_ops(const char *ops_dir, const char *runtime_dir, CacheState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char log_line[300];

	snprintf(path, sizeof(path), "%s/ops.txt", ops_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		int slot = 0;
		int src = 0;
		int dst = 0;
		int flags = 0;
		char data[64];
		trim_line(line);
		if (sscanf(line, "ALLOC %d %63s %d", &slot, data, &flags) == 3) {
			alloc_entry(state, slot, data, flags);
			snprintf(log_line, sizeof(log_line), "[cache] alloc slot=%d flags=%d", slot, flags);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "SPLICE %d %d", &src, &dst) == 2) {
			splice_entry(state, src, dst);
			snprintf(log_line, sizeof(log_line), "[cache] splice %d -> %d", src, dst);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "WRITE %d %63s", &slot, data) == 2) {
			write_entry(state, slot, data);
			snprintf(log_line, sizeof(log_line), "[cache] write slot=%d", slot);
			append_log_line(runtime_dir, log_line);
		} else if (strcmp(line, "DEBUG") == 0) {
			state->debug = 1;
		} else if (strncmp(line, "TOKEN ", 6) == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", line + 6);
		} else if (strncmp(line, "RECEIPT ", 8) == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", line + 8);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *ops_dir = NULL;
	const char *runtime_dir = "./runtime";
	CacheState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	snprintf(state.backing_store, sizeof(state.backing_store), "%s", "clean");
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--ops") == 0 && index + 1 < argc) {
			ops_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (ops_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/cache", runtime_dir);
	ensure_dir(line);
	if (process_ops(ops_dir, runtime_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[cache] ops complete");
	snprintf(line, sizeof(line), "[cache] backing_store=%s", state.backing_store);
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[cache] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[cache] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.backing_store, "root_write") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[cache] root_write merged into backing store — proof created");
		printf("cache write to backing store completed successfully\n");
		return 0;
	}
	if (strcmp(state.backing_store, "root_write") == 0) {
		append_log_line(runtime_dir, "[cache] root_write rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[cache] cache ops completed without backing store write");
	}
	printf("cache ops completed without backing store write\n");
	return 0;
}
