//! Resolves connection ids to per-connection API clients. Clients are cached
//! per id and read their credentials lazily, so config edits take effect
//! without restarting anything.

use crate::config::ConfigService;
use crate::domain::JiraConnection;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::mock::clients::{mock_jira, mock_tempo};
use crate::paths;
use crate::services::jira::{JiraApi, JiraClient};
use crate::services::tempo::{parse_workday_start, TempoApi, TempoClient};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ConnectionManager {
    config: Arc<ConfigService>,
    http: reqwest::Client,
    jira_clients: Mutex<HashMap<String, Arc<dyn JiraApi>>>,
    tempo_clients: Mutex<HashMap<String, Arc<dyn TempoApi>>>,
    /// accountId per connection, with the credentials it was resolved for.
    account_ids: Mutex<HashMap<String, (String, String)>>,
}

fn find(config: &ConfigService, id: &str) -> AppResult<JiraConnection> {
    config
        .get()
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::new(ErrorCode::ConfigInvalid, format!("Unknown Jira connection: {id}")))
}

impl ConnectionManager {
    pub fn new(config: Arc<ConfigService>, http: reqwest::Client) -> Self {
        Self {
            config,
            http,
            jira_clients: Mutex::new(HashMap::new()),
            tempo_clients: Mutex::new(HashMap::new()),
            account_ids: Mutex::new(HashMap::new()),
        }
    }

    pub fn connection(&self, id: &str) -> AppResult<JiraConnection> {
        find(&self.config, id)
    }

    pub fn jira(&self, id: &str) -> Arc<dyn JiraApi> {
        let mut clients = self.jira_clients.lock().unwrap();
        clients
            .entry(id.to_string())
            .or_insert_with(|| {
                if paths::is_mock_mode() {
                    return mock_jira(id);
                }
                let config = self.config.clone();
                let id = id.to_string();
                Arc::new(JiraClient::new(Arc::new(move || find(&config, &id).map(|c| c.jira)), self.http.clone()))
            })
            .clone()
    }

    pub fn tempo(&self, id: &str) -> Arc<dyn TempoApi> {
        if let Some(client) = self.tempo_clients.lock().unwrap().get(id) {
            return client.clone();
        }
        let client: Arc<dyn TempoApi> = if paths::is_mock_mode() {
            mock_tempo(id)
        } else {
            let config = self.config.clone();
            let workday = self.config.clone();
            let conn_id = id.to_string();
            Arc::new(TempoClient::new(
                Arc::new(move || find(&config, &conn_id).map(|c| c.tempo)),
                self.jira(id),
                Arc::new(move || parse_workday_start(&workday.get().workday_start)),
                self.http.clone(),
            ))
        };
        self.tempo_clients.lock().unwrap().insert(id.to_string(), client.clone());
        client
    }

    /// Jira accountId of the connection's user, cached until credentials change.
    pub async fn account_id(&self, id: &str) -> AppResult<String> {
        let connection = self.connection(id)?;
        let credentials = format!("{}|{}", connection.jira.base_url, connection.jira.email);
        if let Some((key, account)) = self.account_ids.lock().unwrap().get(id) {
            if *key == credentials {
                return Ok(account.clone());
            }
        }
        let account = self.jira(id).get_myself().await?.account_id;
        self.account_ids.lock().unwrap().insert(id.to_string(), (credentials, account.clone()));
        Ok(account)
    }
}
