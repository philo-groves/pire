#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct SpoolState {
	char dest[64];
	char owner[16];
	char token[32];
	char receipt[32];
	int debug_token;
} SpoolState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x15, 'p' ^ 0x15, 'l' ^ 0x15, '-' ^ 0x15, 't' ^ 0x15, 'o' ^ 0x15,
	'k' ^ 0x15, 'e' ^ 0x15, 'n' ^ 0x15, '-' ^ 0x15, '5' ^ 0x15, '5' ^ 0x15,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x15);
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
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/spool/spool.log", runtime_dir);
	file = fopen(path, "a");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", line);
	fclose(file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/spool/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{print-spool-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5555UL);
	snprintf(path, sizeof(path), "%s/spool/spool.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/spool/spool.receipt", runtime_dir);
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

static int load_job(const char *job_dir, SpoolState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(state->owner, sizeof(state->owner), "%s", "user");
	snprintf(path, sizeof(path), "%s/job.txt", job_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		if (strcmp(line, "@DEBUG TOKEN") == 0) {
			state->debug_token = 1;
			continue;
		}
		if (strncmp(line, "DEST ", 5) == 0) {
			snprintf(state->dest, sizeof(state->dest), "%s", line + 5);
			continue;
		}
		if (strncmp(line, "@PJL SET ", 9) != 0) {
			continue;
		}
		value = strchr(line + 9, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line + 9, "OWNER") == 0) {
			snprintf(state->owner, sizeof(state->owner), "%s", value);
		} else if (strcmp(line + 9, "TOKEN") == 0) {
			snprintf(state->token, sizeof(state->token), "%s", value);
		} else if (strcmp(line + 9, "RECEIPT") == 0) {
			snprintf(state->receipt, sizeof(state->receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *job_dir = NULL;
	const char *runtime_dir = "./runtime";
	SpoolState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--job") == 0 && index + 1 < argc) {
			job_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (job_dir == NULL) {
		return 2;
	}
	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/spool", runtime_dir);
	ensure_dir(line);
	if (load_job(job_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[spool] loaded job");
	snprintf(line, sizeof(line), "[spool] dest=%s", state.dest[0] != '\0' ? state.dest : "(none)");
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[spool] owner=%s", state.owner);
	append_log_line(runtime_dir, line);
	if (state.debug_token) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[spool] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[spool] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strstr(state.dest, "${root_print}") != NULL && strcmp(state.owner, "root") == 0 &&
		strcmp(state.token, secret_token) == 0 && strcmp(state.receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[spool] root_print dispatched proof path");
		printf("root print executed successfully\n");
		return 0;
	}
	if (strstr(state.dest, "${root_print}") != NULL) {
		append_log_line(runtime_dir, "[spool] root_print rejected: missing token, receipt, or owner gate");
	} else {
		append_log_line(runtime_dir, "[spool] job printed without privileged action");
	}
	printf("spool job completed without privileged action\n");
	return 0;
}
