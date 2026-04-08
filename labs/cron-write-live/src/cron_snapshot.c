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
	unsigned int spool_mode;
	char job_user[16];
	char run_as[16];
	char supplied_token[16];
	char supplied_receipt[32];
	int debug;
} SpoolState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'c' ^ 0x47, 'r' ^ 0x47, 'o' ^ 0x47, 'n' ^ 0x47, '-' ^ 0x47, 't' ^ 0x47,
	'o' ^ 0x47, 'k' ^ 0x47, 'e' ^ 0x47, 'n' ^ 0x47, '-' ^ 0x47, '3' ^ 0x47,
	'8' ^ 0x47,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x47);
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
	snprintf(path, sizeof(path), "%s/spool/cron.log", runtime_dir);
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
	fprintf(file, "FLAG{cron-write-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x3838UL);
	snprintf(path, sizeof(path), "%s/spool/cron.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/spool/cron.receipt", runtime_dir);
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

static int load_spool(const char *spool_dir, SpoolState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	state->spool_mode = 0700;
	snprintf(state->run_as, sizeof(state->run_as), "%s", "user_exec");
	snprintf(path, sizeof(path), "%s/spool.conf", spool_dir);
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
		if (strcmp(line, "spool_mode") == 0) {
			state->spool_mode = (unsigned int)strtoul(value, NULL, 8);
		} else if (strcmp(line, "job_user") == 0) {
			snprintf(state->job_user, sizeof(state->job_user), "%s", value);
		} else if (strcmp(line, "run_as") == 0) {
			snprintf(state->run_as, sizeof(state->run_as), "%s", value);
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
 * Validate job privilege level against spool directory permissions.
 * If the spool directory is not group-writable, non-root users
 * cannot schedule root_exec jobs.
 *
 * Reads spool_mode from the parsed spool header to determine
 * directory permissions for the access decision.
 */
static void validate_job_access(SpoolState *state) {
	if (strcmp(state->run_as, "root_exec") != 0) {
		return;
	}
	if (!(state->spool_mode & 020)) {
		snprintf(state->run_as, sizeof(state->run_as), "%s", "user_exec");
	}
}

int main(int argc, char **argv) {
	const char *spool_dir = NULL;
	const char *runtime_dir = "./runtime";
	SpoolState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--spool") == 0 && index + 1 < argc) {
			spool_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (spool_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/spool", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_spool(spool_dir, &state) != 0) {
		return 1;
	}
	validate_job_access(&state);
	append_log_line(runtime_dir, "[cron] loaded spool");
	snprintf(line, sizeof(line), "[cron] spool_mode=%04o", state.spool_mode);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[cron] run_as=%s", state.run_as);
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[cron] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[cron] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.run_as, "root_exec") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_exec created proof artifact");
		printf("root job executed successfully\n");
		return 0;
	}
	if (strcmp(state.run_as, "root_exec") == 0) {
		append_log_line(runtime_dir, "[cron] root_exec rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[cron] job completed without privileged action");
	}
	printf("cron job completed without privileged action\n");
	return 0;
}
