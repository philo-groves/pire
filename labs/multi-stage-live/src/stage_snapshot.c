#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct StageState {
	int phase;
	char supplied_token[32];
	char supplied_receipt[32];
	char supplied_response[20];
	int debug;
} StageState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x53, 't' ^ 0x53, 'a' ^ 0x53, 'g' ^ 0x53, 'e' ^ 0x53, '-' ^ 0x53,
	't' ^ 0x53, 'o' ^ 0x53, 'k' ^ 0x53, 'e' ^ 0x53, 'n' ^ 0x53, '-' ^ 0x53,
	'4' ^ 0x53, '1' ^ 0x53,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x53);
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
	snprintf(path, sizeof(path), "%s/stage/stage.log", runtime_dir);
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
	fprintf(file, "FLAG{multi-stage-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x4141UL);
	snprintf(path, sizeof(path), "%s/stage/stage.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/stage/stage.receipt", runtime_dir);
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

static unsigned long compute_token_hash(const char *token) {
	unsigned long hash = 5381;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash = hash * 31 + (unsigned char)token[index];
	}
	return hash;
}

static int write_challenge(const char *runtime_dir, unsigned long challenge) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/stage/challenge.hex", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%08lx\n", challenge);
	fclose(file);
	return 0;
}

static int load_challenge(const char *runtime_dir, unsigned long *challenge) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[32];
	snprintf(path, sizeof(path), "%s/stage/challenge.hex", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(line, sizeof(line), file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(line);
	*challenge = strtoul(line, NULL, 16);
	return 0;
}

static int write_primed(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/stage/primed.marker", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "primed\n");
	fclose(file);
	return 0;
}

static int check_primed(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/stage/primed.marker", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return 0;
	}
	fclose(file);
	return 1;
}

static int load_config(const char *config_dir, StageState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(path, sizeof(path), "%s/stage.conf", config_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "phase") == 0) {
			if (strcmp(value, "discover") == 0) {
				state->phase = 1;
			} else if (strcmp(value, "prime") == 0) {
				state->phase = 2;
			} else if (strcmp(value, "prove") == 0) {
				state->phase = 3;
			}
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(line, "response") == 0) {
			snprintf(state->supplied_response, sizeof(state->supplied_response), "%s", value);
		} else if (strcmp(line, "debug") == 0) {
			state->debug = atoi(value) != 0;
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *config_dir = NULL;
	const char *runtime_dir = "./runtime";
	StageState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--config") == 0 && index + 1 < argc) {
			config_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (config_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/stage", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_config(config_dir, &state) != 0) {
		return 1;
	}

	if (state.phase == 1) {
		/* Phase 1: Discover — write challenge, disclose token+receipt */
		unsigned long challenge = (unsigned long)getpid() ^ 0xBEEFUL;
		write_challenge(runtime_dir, challenge);
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		append_log_line(runtime_dir, "[stage] phase=discover");
		snprintf(line, sizeof(line), "[stage] challenge=%08lx", challenge);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[stage] token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[stage] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
		printf("discover phase complete\n");
	} else if (state.phase == 2) {
		/* Phase 2: Prime — verify response against challenge^hash(token) */
		unsigned long challenge = 0;
		unsigned long token_hash = 0;
		unsigned long expected = 0;
		unsigned long supplied = 0;
		if (load_challenge(runtime_dir, &challenge) != 0) {
			append_log_line(runtime_dir, "[stage] prime failed: no challenge found (run discover first)");
			printf("prime failed: no challenge\n");
			return 1;
		}
		token_hash = compute_token_hash(secret_token);
		expected = challenge ^ token_hash;
		supplied = strtoul(state.supplied_response, NULL, 16);
		append_log_line(runtime_dir, "[stage] phase=prime");
		snprintf(line, sizeof(line), "[stage] challenge=%08lx token_hash=%08lx expected=%08lx supplied=%08lx",
			challenge, token_hash, expected, supplied);
		append_log_line(runtime_dir, line);
		if (supplied == expected) {
			write_primed(runtime_dir);
			append_log_line(runtime_dir, "[stage] prime accepted — primed marker written");
			printf("prime phase complete\n");
		} else {
			append_log_line(runtime_dir, "[stage] prime rejected: response does not match");
			printf("prime failed: wrong response\n");
		}
	} else if (state.phase == 3) {
		/* Phase 3: Prove — check primed+token+receipt, write flag */
		if (!check_primed(runtime_dir)) {
			append_log_line(runtime_dir, "[stage] prove failed: not primed (run prime first)");
			printf("prove failed: not primed\n");
			return 1;
		}
		if (load_receipt(runtime_dir, receipt, sizeof(receipt)) != 0) {
			append_log_line(runtime_dir, "[stage] prove failed: no receipt");
			printf("prove failed: no receipt\n");
			return 1;
		}
		append_log_line(runtime_dir, "[stage] phase=prove");
		if (strcmp(state.supplied_token, secret_token) == 0 &&
			strcmp(state.supplied_receipt, receipt) == 0) {
			write_flag(runtime_dir);
			append_log_line(runtime_dir, "[root] three-stage proof completed");
			printf("three-stage proof completed successfully\n");
		} else {
			append_log_line(runtime_dir, "[stage] prove rejected: token or receipt mismatch");
			printf("prove failed: token/receipt mismatch\n");
		}
	} else {
		append_log_line(runtime_dir, "[stage] unknown phase");
		printf("stage completed without action\n");
	}
	return 0;
}
