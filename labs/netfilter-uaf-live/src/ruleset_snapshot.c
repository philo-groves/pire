#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define POOL_SIZE 4
#define MAX_BINDS 4

typedef struct RuleSlot {
	char name[16];
	char value[16];
	int active;
} RuleSlot;

typedef struct BindEntry {
	char rule_name[16];
	int target_slot;
	int bound;
} BindEntry;

typedef struct BatchState {
	RuleSlot pool[POOL_SIZE];
	BindEntry binds[MAX_BINDS];
	char exec_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug;
} BatchState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'n' ^ 0x43, 'f' ^ 0x43, 't' ^ 0x43, '-' ^ 0x43, 't' ^ 0x43, 'o' ^ 0x43,
	'k' ^ 0x43, 'e' ^ 0x43, 'n' ^ 0x43, '-' ^ 0x43, '5' ^ 0x43, '3' ^ 0x43,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x43);
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
	snprintf(path, sizeof(path), "%s/nft/ruleset.log", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{netfilter-uaf-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5353UL);
	snprintf(path, sizeof(path), "%s/nft/ruleset.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/nft/ruleset.receipt", runtime_dir);
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

static int find_slot_by_name(BatchState *state, const char *name) {
	int index = 0;
	for (; index < POOL_SIZE; index++) {
		if (strcmp(state->pool[index].name, name) == 0) {
			return index;
		}
	}
	return -1;
}

static int find_free_slot(BatchState *state) {
	int index = 0;
	for (; index < POOL_SIZE; index++) {
		if (!state->pool[index].active) {
			return index;
		}
	}
	return -1;
}

static int find_bind_by_rule(BatchState *state, const char *rule_name) {
	int index = 0;
	for (; index < MAX_BINDS; index++) {
		if (state->binds[index].bound && strcmp(state->binds[index].rule_name, rule_name) == 0) {
			return index;
		}
	}
	return -1;
}

static int find_free_bind(BatchState *state) {
	int index = 0;
	for (; index < MAX_BINDS; index++) {
		if (!state->binds[index].bound) {
			return index;
		}
	}
	return -1;
}

/* Create a named set in the rule pool. */
static void batch_create(BatchState *state, const char *name, const char *value) {
	int slot = find_free_slot(state);
	if (slot < 0) {
		return;
	}
	snprintf(state->pool[slot].name, sizeof(state->pool[slot].name), "%s", name);
	snprintf(state->pool[slot].value, sizeof(state->pool[slot].value), "%s", value);
	state->pool[slot].active = 1;
}

/* Bind a rule to a named set. Stores the slot index as the reference. */
static void batch_bind(BatchState *state, const char *rule_name, const char *set_name) {
	int set_slot = find_slot_by_name(state, set_name);
	int bind_slot = find_free_bind(state);
	if (set_slot < 0 || bind_slot < 0) {
		return;
	}
	snprintf(state->binds[bind_slot].rule_name, sizeof(state->binds[bind_slot].rule_name), "%s", rule_name);
	state->binds[bind_slot].target_slot = set_slot;
	state->binds[bind_slot].bound = 1;
}

/* Delete a set by name. Marks the slot inactive but does NOT invalidate
   any bind entries that reference this slot. */
static void batch_delete(BatchState *state, const char *name) {
	int slot = find_slot_by_name(state, name);
	if (slot < 0) {
		return;
	}
	state->pool[slot].active = 0;
	memset(state->pool[slot].name, 0, sizeof(state->pool[slot].name));
	memset(state->pool[slot].value, 0, sizeof(state->pool[slot].value));
}

/* Activate a rule. Follows the bind's stored slot reference and reads
   the current value — even if the original set was deleted and the slot
   was reused by a different CREATE. */
static void batch_activate(BatchState *state, const char *rule_name) {
	int bind_idx = find_bind_by_rule(state, rule_name);
	int slot = 0;
	if (bind_idx < 0) {
		return;
	}
	slot = state->binds[bind_idx].target_slot;
	if (slot < 0 || slot >= POOL_SIZE) {
		return;
	}
	snprintf(state->exec_action, sizeof(state->exec_action), "%s", state->pool[slot].value);
}

static int process_batch(const char *batch_dir, const char *runtime_dir, BatchState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char log_line[300];
	char arg1[32];
	char arg2[32];

	snprintf(path, sizeof(path), "%s/batch.txt", batch_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		trim_line(line);
		if (sscanf(line, "CREATE %31s %31s", arg1, arg2) == 2) {
			batch_create(state, arg1, arg2);
			snprintf(log_line, sizeof(log_line), "[nft] create set=%s value=%s", arg1, arg2);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "BIND %31s %31s", arg1, arg2) == 2) {
			batch_bind(state, arg1, arg2);
			snprintf(log_line, sizeof(log_line), "[nft] bind rule=%s -> set=%s", arg1, arg2);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "DELETE %31s", arg1) == 1 && strncmp(line, "DEBUG", 5) != 0) {
			batch_delete(state, arg1);
			snprintf(log_line, sizeof(log_line), "[nft] delete set=%s", arg1);
			append_log_line(runtime_dir, log_line);
		} else if (sscanf(line, "ACTIVATE %31s", arg1) == 1) {
			batch_activate(state, arg1);
			snprintf(log_line, sizeof(log_line), "[nft] activate rule=%s", arg1);
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
	const char *batch_dir = NULL;
	const char *runtime_dir = "./runtime";
	BatchState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--batch") == 0 && index + 1 < argc) {
			batch_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (batch_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/nft", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (process_batch(batch_dir, runtime_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[nft] batch complete");
	snprintf(line, sizeof(line), "[nft] exec_action=%s",
		state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[nft] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[nft] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_exec") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_exec via dangling bind — proof created");
		printf("root exec via ruleset completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_exec") == 0) {
		append_log_line(runtime_dir, "[nft] root_exec rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[nft] batch completed without privileged action");
	}
	printf("ruleset batch completed without privileged action\n");
	return 0;
}
