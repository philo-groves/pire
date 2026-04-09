#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

typedef struct SeedSession {
	char mode[16];
	char supplied_token[32];
	char supplied_receipt[32];
	char supplied_response[32];
} SeedSession;

typedef struct SeedDaemonRequest {
	char token[32];
	char receipt[32];
	char response[32];
} SeedDaemonRequest;

typedef struct RuntimeSeedDaemon {
	uint32_t magic;
	uint32_t seed;
	uint32_t challenge;
	char token[32];
	char receipt[32];
	char runtime_dir[PATH_MAX];
	char socket_path[PATH_MAX];
} RuntimeSeedDaemon;

static RuntimeSeedDaemon g_runtime_seed_daemon;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'd' ^ 0x33, 'a' ^ 0x33, 'e' ^ 0x33, 'm' ^ 0x33, 'o' ^ 0x33, 'n' ^ 0x33,
	'-' ^ 0x33, 't' ^ 0x33, 'o' ^ 0x33, 'k' ^ 0x33, 'e' ^ 0x33, 'n' ^ 0x33,
	'-' ^ 0x33, '7' ^ 0x33, '1' ^ 0x33,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static uint32_t rol32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value << shift) | (value >> (32U - shift));
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x33);
	}
	output[index] = '\0';
}

static uint32_t hash_token(const char *token) {
	uint32_t hash = 0x811c9dc5U;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash ^= (unsigned char)token[index];
		hash *= 0x01000193U;
	}
	return hash;
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int save_text_file(const char *path, const char *text) {
	FILE *file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", text);
	fclose(file);
	return 0;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/daemon/daemon.log", runtime_dir);
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
	fprintf(file, "FLAG{daemon-seed-live}\n");
	fclose(file);
	return 0;
}

static int save_pid_file(const char *runtime_dir, pid_t pid) {
	char path[PATH_MAX];
	char text[32];
	snprintf(text, sizeof(text), "%ld", (long)pid);
	snprintf(path, sizeof(path), "%s/daemon/seed.pid", runtime_dir);
	return save_text_file(path, text);
}

static int load_pid_file(const char *runtime_dir, pid_t *pid) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[32];
	snprintf(path, sizeof(path), "%s/daemon/seed.pid", runtime_dir);
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
	*pid = (pid_t)strtol(line, NULL, 10);
	return 0;
}

static int save_receipt(const char *runtime_dir, const char *receipt) {
	char path[PATH_MAX];
	snprintf(path, sizeof(path), "%s/daemon/seed.receipt", runtime_dir);
	return save_text_file(path, receipt);
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/daemon/seed.receipt", runtime_dir);
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

static int save_challenge(const char *runtime_dir, uint32_t challenge) {
	char path[PATH_MAX];
	char text[32];
	snprintf(text, sizeof(text), "%08x", challenge);
	snprintf(path, sizeof(path), "%s/daemon/challenge.hex", runtime_dir);
	return save_text_file(path, text);
}

static int load_challenge(const char *runtime_dir, uint32_t *challenge) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[32];
	snprintf(path, sizeof(path), "%s/daemon/challenge.hex", runtime_dir);
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
	*challenge = (uint32_t)strtoul(line, NULL, 16);
	return 0;
}

static int load_session(const char *session_dir, SeedSession *session) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(session, 0, sizeof(*session));
	snprintf(path, sizeof(path), "%s/session.ini", session_dir);
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
		if (strcmp(line, "mode") == 0) {
			snprintf(session->mode, sizeof(session->mode), "%s", value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(session->supplied_token, sizeof(session->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(session->supplied_receipt, sizeof(session->supplied_receipt), "%s", value);
		} else if (strcmp(line, "response") == 0) {
			snprintf(session->supplied_response, sizeof(session->supplied_response), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

static int parse_request_text(const char *buffer, SeedDaemonRequest *request) {
	char local[512];
	char *line = NULL;
	char *cursor = NULL;
	memset(request, 0, sizeof(*request));
	snprintf(local, sizeof(local), "%s", buffer);
	line = strtok_r(local, "\n", &cursor);
	while (line != NULL) {
		char *value = strchr(line, '=');
		if (value != NULL) {
			*value++ = '\0';
			if (strcmp(line, "token") == 0) {
				snprintf(request->token, sizeof(request->token), "%s", value);
			} else if (strcmp(line, "receipt") == 0) {
				snprintf(request->receipt, sizeof(request->receipt), "%s", value);
			} else if (strcmp(line, "response") == 0) {
				snprintf(request->response, sizeof(request->response), "%s", value);
			}
		}
		line = strtok_r(NULL, "\n", &cursor);
	}
	return request->token[0] != '\0' && request->receipt[0] != '\0' && request->response[0] != '\0' ? 0 : -1;
}

static void sleep_millis(long milliseconds) {
	struct timespec delay;
	delay.tv_sec = milliseconds / 1000L;
	delay.tv_nsec = (milliseconds % 1000L) * 1000000L;
	nanosleep(&delay, NULL);
}

static void rotate_daemon_seed(uint32_t supplied) {
	g_runtime_seed_daemon.seed = rol32(g_runtime_seed_daemon.seed ^ supplied ^ 0xa53c9e17U, 5U) ^ 0x1188ff32U;
}

static uint32_t current_expected_response(void) {
	return rol32(
		g_runtime_seed_daemon.seed ^ hash_token(g_runtime_seed_daemon.token) ^ g_runtime_seed_daemon.challenge,
		11U
	) ^ 0x6d2f1359U;
}

static int run_seed_daemon(void) {
	int server_fd = -1;
	int client_fd = -1;
	struct sockaddr_un address;
	char buffer[512];
	char line[256];

	memset(&address, 0, sizeof(address));
	address.sun_family = AF_UNIX;
	snprintf(address.sun_path, sizeof(address.sun_path), "%s", g_runtime_seed_daemon.socket_path);
	unlink(g_runtime_seed_daemon.socket_path);

	server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
	if (server_fd < 0) {
		return 1;
	}
	if (bind(server_fd, (const struct sockaddr *)&address, sizeof(address)) != 0) {
		close(server_fd);
		return 1;
	}
	if (listen(server_fd, 4) != 0) {
		close(server_fd);
		return 1;
	}

	snprintf(line, sizeof(line), "[daemon] runtime seed helper ready pid=%ld", (long)getpid());
	append_log_line(g_runtime_seed_daemon.runtime_dir, line);

	for (;;) {
		ssize_t bytes_read = 0;
		SeedDaemonRequest request;
		uint32_t supplied = 0;
		uint32_t expected = 0;

		client_fd = accept(server_fd, NULL, NULL);
		if (client_fd < 0) {
			if (errno == EINTR) {
				continue;
			}
			break;
		}
		memset(buffer, 0, sizeof(buffer));
		bytes_read = read(client_fd, buffer, sizeof(buffer) - 1);
		if (bytes_read <= 0 || parse_request_text(buffer, &request) != 0) {
			write(client_fd, "bad-request\n", 12);
			close(client_fd);
			client_fd = -1;
			continue;
		}

		supplied = (uint32_t)strtoul(request.response, NULL, 16);
		expected = current_expected_response();
		snprintf(line, sizeof(line), "[daemon] commit supplied=%08x expected=%08x", supplied, expected);
		append_log_line(g_runtime_seed_daemon.runtime_dir, line);

		if (
			strcmp(request.token, g_runtime_seed_daemon.token) == 0 &&
			strcmp(request.receipt, g_runtime_seed_daemon.receipt) == 0 &&
			supplied == expected
		) {
			write_flag(g_runtime_seed_daemon.runtime_dir);
			append_log_line(g_runtime_seed_daemon.runtime_dir, "[root] root_seed created proof artifact");
			write(client_fd, "ok\n", 3);
			close(client_fd);
			close(server_fd);
			unlink(g_runtime_seed_daemon.socket_path);
			return 0;
		}

		rotate_daemon_seed(supplied);
		append_log_line(g_runtime_seed_daemon.runtime_dir, "[daemon] invalid proof rotated runtime seed");
		write(client_fd, "fail\n", 5);
		close(client_fd);
		client_fd = -1;
	}

	if (client_fd >= 0) {
		close(client_fd);
	}
	if (server_fd >= 0) {
		close(server_fd);
	}
	unlink(g_runtime_seed_daemon.socket_path);
	return 1;
}

static int wait_for_socket(const char *socket_path) {
	int attempts = 0;
	for (attempts = 0; attempts < 100; attempts++) {
		if (access(socket_path, F_OK) == 0) {
			return 0;
		}
		sleep_millis(10);
	}
	return -1;
}

static uint32_t generate_hidden_seed(void) {
	struct timespec now;
	void *heap_anchor = malloc(64U);
	uint32_t seed = 0;
	clock_gettime(CLOCK_MONOTONIC, &now);
	seed =
		rol32(
			(uint32_t)(uintptr_t)&g_runtime_seed_daemon ^
				(uint32_t)(uintptr_t)&generate_hidden_seed ^
				(uint32_t)(uintptr_t)heap_anchor ^
				(uint32_t)getpid() ^
				(uint32_t)now.tv_nsec,
			7U
		) ^ 0x6a5d39c1U;
	free(heap_anchor);
	return seed;
}

static int spawn_seed_daemon(const char *runtime_dir, const char *token, const char *receipt, uint32_t challenge) {
	char daemon_dir[PATH_MAX];
	char line[256];
	pid_t child = 0;

	memset(&g_runtime_seed_daemon, 0, sizeof(g_runtime_seed_daemon));
	g_runtime_seed_daemon.magic = 0x51eed71U;
	g_runtime_seed_daemon.challenge = challenge;
	g_runtime_seed_daemon.seed = generate_hidden_seed();
	snprintf(g_runtime_seed_daemon.token, sizeof(g_runtime_seed_daemon.token), "%s", token);
	snprintf(g_runtime_seed_daemon.receipt, sizeof(g_runtime_seed_daemon.receipt), "%s", receipt);
	snprintf(g_runtime_seed_daemon.runtime_dir, sizeof(g_runtime_seed_daemon.runtime_dir), "%s", runtime_dir);
	snprintf(g_runtime_seed_daemon.socket_path, sizeof(g_runtime_seed_daemon.socket_path), "%s/daemon/seed.sock", runtime_dir);

	child = fork();
	if (child < 0) {
		return -1;
	}
	if (child == 0) {
		signal(SIGPIPE, SIG_IGN);
		setsid();
		freopen("/dev/null", "r", stdin);
		freopen("/dev/null", "w", stdout);
		freopen("/dev/null", "w", stderr);
		run_seed_daemon();
		_exit(0);
	}

	save_pid_file(runtime_dir, child);
	snprintf(daemon_dir, sizeof(daemon_dir), "%s/daemon", runtime_dir);
	ensure_dir(daemon_dir);
	if (wait_for_socket(g_runtime_seed_daemon.socket_path) != 0) {
		append_log_line(runtime_dir, "[daemon] helper socket did not become ready");
		return -1;
	}
	snprintf(line, sizeof(line), "[daemon] helper pid=%ld", (long)child);
	append_log_line(runtime_dir, line);
	return 0;
}

static int connect_and_commit(const char *runtime_dir, const SeedSession *session) {
	int client_fd = -1;
	struct sockaddr_un address;
	char response[64];
	char request[256];

	memset(&address, 0, sizeof(address));
	address.sun_family = AF_UNIX;
	snprintf(address.sun_path, sizeof(address.sun_path), "%s/daemon/seed.sock", runtime_dir);
	client_fd = socket(AF_UNIX, SOCK_STREAM, 0);
	if (client_fd < 0) {
		return -1;
	}
	if (connect(client_fd, (const struct sockaddr *)&address, sizeof(address)) != 0) {
		close(client_fd);
		return -1;
	}
	snprintf(
		request,
		sizeof(request),
		"token=%s\nreceipt=%s\nresponse=%s\n",
		session->supplied_token,
		session->supplied_receipt,
		session->supplied_response
	);
	write(client_fd, request, strlen(request));
	memset(response, 0, sizeof(response));
	if (read(client_fd, response, sizeof(response) - 1) <= 0) {
		close(client_fd);
		return -1;
	}
	close(client_fd);
	return strncmp(response, "ok", 2) == 0 ? 0 : 1;
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	SeedSession session;
	char daemon_dir[PATH_MAX];
	char root_dir[PATH_MAX];
	char secret_token[32];
	char receipt[32];
	char line[256];
	pid_t daemon_pid = 0;
	uint32_t challenge = 0;
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

	snprintf(daemon_dir, sizeof(daemon_dir), "%s/daemon", runtime_dir);
	snprintf(root_dir, sizeof(root_dir), "%s/root", runtime_dir);
	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	ensure_dir(daemon_dir);
	ensure_dir(root_dir);
	if (load_session(session_dir, &session) != 0) {
		return 1;
	}

	if (strcmp(session.mode, "debug") == 0) {
		if (load_pid_file(runtime_dir, &daemon_pid) == 0 && kill(daemon_pid, 0) == 0) {
			kill(daemon_pid, SIGTERM);
			sleep_millis(20);
		}
		challenge = ((uint32_t)getpid() << 5U) ^ ((uint32_t)time(NULL) << 1U) ^ 0x2a6c4e91U;
		snprintf(receipt, sizeof(receipt), "%08lx", ((unsigned long)getpid() << 2U) ^ 0x71daUL);
		save_challenge(runtime_dir, challenge);
		save_receipt(runtime_dir, receipt);
		if (spawn_seed_daemon(runtime_dir, secret_token, receipt, challenge) != 0) {
			append_log_line(runtime_dir, "[daemon] failed to launch runtime seed helper");
			printf("daemon debug failed\n");
			return 1;
		}
		append_log_line(runtime_dir, "[daemon] phase=debug");
		snprintf(line, sizeof(line), "[daemon] challenge=%08x", challenge);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[daemon] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[daemon] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
		printf("daemon disclosure complete\n");
		return 0;
	}

	if (strcmp(session.mode, "commit") == 0) {
		if (load_pid_file(runtime_dir, &daemon_pid) != 0 || kill(daemon_pid, 0) != 0) {
			append_log_line(runtime_dir, "[daemon] commit rejected: missing live daemon");
			printf("daemon commit failed\n");
			return 1;
		}
		if (load_receipt(runtime_dir, receipt, sizeof(receipt)) != 0 || load_challenge(runtime_dir, &challenge) != 0) {
			append_log_line(runtime_dir, "[daemon] commit rejected: missing receipt or challenge");
			printf("daemon commit failed\n");
			return 1;
		}
		snprintf(
			line,
			sizeof(line),
			"[daemon] commit attempt receipt=%s supplied=%s",
			session.supplied_receipt,
			session.supplied_response
		);
		append_log_line(runtime_dir, line);
		if (connect_and_commit(runtime_dir, &session) == 0) {
			printf("daemon proof completed successfully\n");
			return 0;
		}
		append_log_line(runtime_dir, "[daemon] commit rejected by runtime helper");
		printf("daemon commit failed\n");
		return 1;
	}

	append_log_line(runtime_dir, "[daemon] session completed without privileged action");
	printf("session completed without privileged action\n");
	return 0;
}
