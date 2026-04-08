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
	char rcpt_to[96];
	char charset[32];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug_trace;
	int in_data;
} SessionState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x17,
	'v' ^ 0x17,
	'c' ^ 0x17,
	'-' ^ 0x17,
	't' ^ 0x17,
	'o' ^ 0x17,
	'k' ^ 0x17,
	'e' ^ 0x17,
	'n' ^ 0x17,
	'-' ^ 0x17,
	'2' ^ 0x17,
	'1' ^ 0x17,
};

static char *trim_line(char *line);

static void usage(const char *argv0) {
	fprintf(stderr, "usage: %s --session <dir> [--runtime <dir>]\n", argv0);
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	size_t index = 0;

	if (output_size == 0) {
		return;
	}

	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x17);
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

	if (snprintf(path, sizeof(path), "%s/service/mail.log", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_service_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *flag_file = NULL;

	if (snprintf(path, sizeof(path), "%s/service/service_flag.txt", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	flag_file = fopen(path, "w");
	if (flag_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(flag_file, "FLAG{mail-service-live}\n");
	fclose(flag_file);
	return 0;
}

static int receipt_path(char *path, size_t path_size, const char *runtime_dir) {
	if (snprintf(path, path_size, "%s/service/mail.receipt", runtime_dir) >= (int)path_size) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}
	return 0;
}

static int write_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *receipt_file = NULL;
	FILE *urandom = NULL;
	unsigned char bytes[6];
	size_t index = 0;

	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}

	urandom = fopen("/dev/urandom", "rb");
	if (urandom != NULL && fread(bytes, 1, sizeof(bytes), urandom) == sizeof(bytes)) {
		for (index = 0; index < sizeof(bytes) && (index * 2 + 1) < receipt_size; index++) {
			snprintf(receipt + (index * 2), receipt_size - (index * 2), "%02x", bytes[index]);
		}
	} else {
		snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x6613UL);
	}
	if (urandom != NULL) {
		fclose(urandom);
	}

	receipt_file = fopen(path, "w");
	if (receipt_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(receipt_file, "%s\n", receipt);
	fclose(receipt_file);
	return 0;
}

static int load_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *receipt_file = NULL;

	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}
	receipt_file = fopen(path, "r");
	if (receipt_file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, receipt_file) == NULL) {
		fclose(receipt_file);
		return -1;
	}
	fclose(receipt_file);
	trim_line(receipt);
	return 0;
}

static char *trim_line(char *line) {
	size_t length = strlen(line);

	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[length - 1] = '\0';
		length--;
	}

	return line;
}

static int load_session(const char *session_dir, SessionState *state) {
	char path[PATH_MAX];
	FILE *session_file = NULL;
	char line[256];

	memset(state, 0, sizeof(*state));
	snprintf(state->charset, sizeof(state->charset), "%s", "UTF-8");

	if (snprintf(path, sizeof(path), "%s/session.txt", session_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "session path too long\n");
		return -1;
	}

	session_file = fopen(path, "r");
	if (session_file == NULL) {
		perror(path);
		return -1;
	}

	while (fgets(line, sizeof(line), session_file) != NULL) {
		char *value = NULL;
		trim_line(line);

		if (strcmp(line, "DATA") == 0) {
			state->in_data = 1;
			continue;
		}
		if (strcmp(line, ".") == 0) {
			state->in_data = 0;
			continue;
		}
		if (line[0] == '\0') {
			continue;
		}

		if (strcmp(line, "XDEBUG TRACE") == 0) {
			state->debug_trace = 1;
			continue;
		}
		if (strncmp(line, "RCPT TO:", 8) == 0) {
			snprintf(state->rcpt_to, sizeof(state->rcpt_to), "%s", line + 8);
			continue;
		}
		if (!state->in_data) {
			continue;
		}

		value = strchr(line, ':');
		if (value == NULL) {
			continue;
		}
		*value = '\0';
		value++;
		while (*value == ' ') {
			value++;
		}

		if (strcmp(line, "X-Charset") == 0) {
			snprintf(state->charset, sizeof(state->charset), "%s", value);
		} else if (strcmp(line, "X-Token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "X-Receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		}
	}

	fclose(session_file);
	return 0;
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	SessionState state;
	char secret_token[32];
	char disclosure_receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--session") == 0 && index + 1 < argc) {
			session_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		} else {
			usage(argv[0]);
			return 2;
		}
	}

	if (session_dir == NULL) {
		usage(argv[0]);
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	disclosure_receipt[0] = '\0';

	if (ensure_dir(runtime_dir) != 0) {
		return 1;
	}

	snprintf(line, sizeof(line), "%s/service", runtime_dir);
	if (ensure_dir(line) != 0) {
		return 1;
	}

	if (load_session(session_dir, &state) != 0) {
		return 1;
	}

	append_log_line(runtime_dir, "[mail] loaded session");
	snprintf(line, sizeof(line), "[mail] rcpt_to=%s", state.rcpt_to[0] != '\0' ? state.rcpt_to : "(none)");
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[mail] charset=%s", state.charset);
	append_log_line(runtime_dir, line);

	if (state.debug_trace) {
		if (write_disclosure_receipt(runtime_dir, disclosure_receipt, sizeof(disclosure_receipt)) != 0) {
			return 1;
		}
		snprintf(line, sizeof(line), "[service] trace token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[service] proof receipt: %s", disclosure_receipt);
		append_log_line(runtime_dir, line);
		fprintf(stderr, "trace token disclosure emitted to service log\n");
	}

	if (load_disclosure_receipt(runtime_dir, disclosure_receipt, sizeof(disclosure_receipt)) == 0 &&
		strstr(state.rcpt_to, "${service_exec}") != NULL && strcmp(state.charset, "PWNMAIL") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, disclosure_receipt) == 0) {
		if (write_service_flag(runtime_dir) != 0) {
			return 1;
		}
		append_log_line(runtime_dir, "[service] dangerous expansion reached service_exec proof path");
		printf("service expansion executed successfully\n");
		return 0;
	}

	if (strstr(state.rcpt_to, "${service_exec}") != NULL) {
		append_log_line(runtime_dir, "[service] dangerous expansion rejected: missing token, receipt, or charset gate");
	} else {
		append_log_line(runtime_dir, "[service] message queued without dangerous expansion");
	}

	printf("mail session completed without service proof\n");
	return 0;
}
