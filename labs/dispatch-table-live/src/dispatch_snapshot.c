#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define NUM_NAMED_COMMANDS 6
#define TABLE_SIZE 8

typedef struct DispatchState {
	char exec_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug;
} DispatchState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'd' ^ 0x3b, 'i' ^ 0x3b, 's' ^ 0x3b, 'p' ^ 0x3b, '-' ^ 0x3b, 't' ^ 0x3b,
	'o' ^ 0x3b, 'k' ^ 0x3b, 'e' ^ 0x3b, 'n' ^ 0x3b, '-' ^ 0x3b, '7' ^ 0x3b,
	'8' ^ 0x3b,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x3b);
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
	snprintf(path, sizeof(path), "%s/dispatch/dispatch.log", runtime_dir);
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
	fprintf(file, "FLAG{dispatch-table-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x7878UL);
	snprintf(path, sizeof(path), "%s/dispatch/dispatch.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/dispatch/dispatch.receipt", runtime_dir);
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

/* Named command handlers (slots 0-5) */
static void handle_ping(DispatchState *state) { (void)state; }
static void handle_stat(DispatchState *state) { (void)state; }
static void handle_list(DispatchState *state) { (void)state; }
static void handle_read(DispatchState *state) { (void)state; }
static void handle_write(DispatchState *state) { (void)state; }
static void handle_delete(DispatchState *state) { (void)state; }

/* Slot 6: reserved, returns without action */
static void handle_reserved(DispatchState *state) { (void)state; }

/* Slot 7: not mapped to any named command */
static void handle_op_7(DispatchState *state) {
	snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_dispatch");
}

typedef void (*handler_fn)(DispatchState *);

static handler_fn dispatch_table[TABLE_SIZE] = {
	handle_ping,
	handle_stat,
	handle_list,
	handle_read,
	handle_write,
	handle_delete,
	handle_reserved,
	handle_op_7,
};

static int resolve_command(const char *cmd) {
	char *endptr = NULL;
	long idx = 0;
	if (strcmp(cmd, "PING") == 0) return 0;
	if (strcmp(cmd, "STAT") == 0) return 1;
	if (strcmp(cmd, "LIST") == 0) return 2;
	if (strcmp(cmd, "READ") == 0) return 3;
	if (strcmp(cmd, "WRITE") == 0) return 4;
	if (strcmp(cmd, "DELETE") == 0) return 5;
	/* Fall through to raw numeric dispatch */
	idx = strtol(cmd, &endptr, 10);
	if (endptr != cmd && *endptr == '\0' && idx >= 0 && idx < TABLE_SIZE) {
		return (int)idx;
	}
	return -1;
}

static int process_commands(const char *cmd_dir, const char *runtime_dir, DispatchState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char log_line[300];

	snprintf(path, sizeof(path), "%s/commands.txt", cmd_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		trim_line(line);
		if (strncmp(line, "CMD ", 4) == 0) {
			int slot = resolve_command(line + 4);
			if (slot >= 0 && slot < TABLE_SIZE) {
				dispatch_table[slot](state);
				snprintf(log_line, sizeof(log_line), "[dispatch] cmd=%s slot=%d", line + 4, slot);
			} else {
				snprintf(log_line, sizeof(log_line), "[dispatch] cmd=%s rejected: invalid", line + 4);
			}
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
	const char *cmd_dir = NULL;
	const char *runtime_dir = "./runtime";
	DispatchState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--commands") == 0 && index + 1 < argc) {
			cmd_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (cmd_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/dispatch", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (process_commands(cmd_dir, runtime_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[dispatch] processing complete");
	snprintf(line, sizeof(line), "[dispatch] exec_action=%s",
		state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[dispatch] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[dispatch] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_dispatch") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_dispatch created proof artifact");
		printf("root dispatch completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_dispatch") == 0) {
		append_log_line(runtime_dir, "[dispatch] root_dispatch rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[dispatch] completed without privileged dispatch");
	}
	printf("dispatch completed without privileged dispatch\n");
	return 0;
}
