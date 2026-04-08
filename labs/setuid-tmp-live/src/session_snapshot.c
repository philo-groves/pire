#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct SessionState {
	unsigned int caller_umask;
	unsigned int acl_override;
	unsigned int effective_mode;
	char access_level[16];
	char supplied_token[16];
	char supplied_receipt[32];
	int debug;
} SessionState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x33, 'u' ^ 0x33, 'i' ^ 0x33, 'd' ^ 0x33, '-' ^ 0x33, 't' ^ 0x33,
	'o' ^ 0x33, 'k' ^ 0x33, 'e' ^ 0x33, 'n' ^ 0x33, '-' ^ 0x33, '5' ^ 0x33,
	'2' ^ 0x33,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x33);
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
	snprintf(path, sizeof(path), "%s/session/session.log", runtime_dir);
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
	fprintf(file, "FLAG{setuid-tmp-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5252UL);
	snprintf(path, sizeof(path), "%s/session/session.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/session/session.receipt", runtime_dir);
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

static int load_session(const char *session_dir, SessionState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	state->caller_umask = 077;
	snprintf(path, sizeof(path), "%s/session.conf", session_dir);
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
		if (strcmp(line, "umask") == 0) {
			state->caller_umask = (unsigned int)strtoul(value, NULL, 8);
		} else if (strcmp(line, "acl_override") == 0) {
			state->acl_override = (unsigned int)strtoul(value, NULL, 8);
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(line, "debug") == 0) {
			state->debug = atoi(value) != 0;
		}
	}
	fclose(file);
	return 0;
}

/*
 * Compute effective file mode for the session record.
 * Base mode is 0666. Normally restricted by caller's umask.
 * If acl_override is set, it replaces the computed mode entirely.
 */
static void compute_effective_mode(SessionState *state) {
	unsigned int base_mode = 0666;
	if (state->acl_override != 0) {
		state->effective_mode = state->acl_override;
	} else {
		state->effective_mode = base_mode & ~state->caller_umask;
	}
	if (state->effective_mode & 004) {
		snprintf(state->access_level, sizeof(state->access_level), "%s", "world_read");
	} else {
		snprintf(state->access_level, sizeof(state->access_level), "%s", "private");
	}
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	SessionState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--session") == 0 && index + 1 < argc) {
			session_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (session_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/session", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_session(session_dir, &state) != 0) {
		return 1;
	}
	compute_effective_mode(&state);
	append_log_line(runtime_dir, "[session] loaded config");
	snprintf(line, sizeof(line), "[session] umask=%04o acl_override=%04o effective=%04o",
		state.caller_umask, state.acl_override, state.effective_mode);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[session] access_level=%s", state.access_level);
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[session] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[session] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.access_level, "world_read") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] world_read session leaked credentials — proof created");
		printf("session credential leak completed successfully\n");
		return 0;
	}
	if (strcmp(state.access_level, "world_read") == 0) {
		append_log_line(runtime_dir, "[session] world_read rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[session] session completed without credential leak");
	}
	printf("session completed without credential leak\n");
	return 0;
}
