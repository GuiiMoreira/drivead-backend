# DriveAd Backend — Documentação de Endpoints da API

**Framework**: NestJS | **Total**: 60 endpoints | **11 módulos**

**Segurança Global**: JWT Auth, Role-based Guards, Rate Limiting (20 req/min), CORS

---

## 1. Root — `app.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/` | — | Health check |

## 2. Auth — `auth/auth.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/auth/signup` | Throttle(1/min) | Enviar OTP por SMS |
| POST | `/auth/verify-otp` | Throttle(5/min) | Verificar OTP e retornar JWT |
| GET | `/auth/me` | JWT | Perfil do usuário autenticado |
| POST | `/auth/refresh` | — | Renovar tokens JWT |
| POST | `/auth/logout` | JWT | Logout |

## 3. Users — `users/users.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| PATCH | `/users/me` | JWT | Atualizar perfil |

## 4. Admin — `admin/admin.controller.ts`

> Todos os endpoints exigem **JWT + AdminGuard**

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/admin/stats` | Estatísticas do dashboard |
| GET | `/admin/monitoring/active-drivers` | Monitorar motoristas ativos |
| GET | `/admin/drivers/pending` | Motoristas pendentes de aprovação |
| POST | `/admin/drivers/:id/approve` | Aprovar motorista |
| GET | `/admin/drivers` | Listar todos os motoristas |
| GET | `/admin/drivers/:id` | Detalhes de um motorista |
| GET | `/admin/campaigns` | Listar todas as campanhas |
| GET | `/admin/campaigns/pending` | Campanhas pendentes |
| POST | `/admin/campaigns/:id/review` | Aprovar/rejeitar campanha |
| GET | `/admin/advertisers` | Listar anunciantes |
| GET | `/admin/advertisers/:id` | Detalhes de anunciante |
| POST | `/admin/advertisers/:id/review` | Aprovar/rejeitar anunciante |
| GET | `/admin/users/admins` | Listar admins |
| POST | `/admin/users/admins` | Criar admin |
| POST | `/admin/assignments/:id/process-payout` | Processar pagamento de motorista |
| GET | `/admin/wallet/pending-withdrawals` | Saques pendentes |
| POST | `/admin/wallet/approve-withdrawal/:id` | Aprovar saque |
| GET | `/admin/proofs/installations/pending` | Provas de instalação pendentes |
| POST | `/admin/proofs/installations/:id/review` | Revisar prova de instalação |
| GET | `/admin/proofs/periodic/pending` | Provas periódicas pendentes |
| POST | `/admin/proofs/periodic/:id/review` | Revisar prova periódica |
| GET | `/admin/fraud-alerts` | Alertas de fraude |
| POST | `/admin/fraud-alerts/:id/resolve` | Resolver alerta de fraude |

## 5. Advertisers — `advertisers/advertisers.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/advertisers` | JWT | Criar conta de anunciante |
| PATCH | `/advertisers/me` | JWT + AdvertiserGuard | Atualizar perfil |
| GET | `/advertisers/me/campaigns` | JWT + AdvertiserGuard | Campanhas do anunciante |
| GET | `/advertisers/me/dashboard-summary` | JWT | Resumo do dashboard |
| POST | `/advertisers/members/invite` | JWT | Convidar membro da equipe |

## 6. Campaigns — `campaigns/campaigns.controller.ts`

> Todos os endpoints exigem **JWT + AdvertiserGuard**

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/campaigns` | Criar campanha (upload de arquivo) |
| POST | `/campaigns/calculate-price` | Calcular preço da campanha |
| POST | `/campaigns/:id/pay` | Gerar link de pagamento |
| GET | `/campaigns/:id` | Detalhes da campanha |
| GET | `/campaigns/:id/report` | Relatório de performance |
| POST | `/campaigns/:id/stop` | Parar campanha |

## 7. Drivers — `drivers/drivers.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/drivers` | JWT | Criar perfil + registrar veículo |
| POST | `/drivers/documents` | JWT + FileFields | Upload de documentos KYC |
| POST | `/drivers/vehicle-photos` | JWT + DriverGuard | Upload fotos do veículo |
| GET | `/drivers/me/campaigns` | JWT + DriverGuard | Campanhas disponíveis |
| POST | `/drivers/me/campaigns/:id/apply` | JWT + DriverGuard | Candidatar-se a campanha |
| GET | `/drivers/me/assignment` | JWT + DriverGuard | Atribuição atual |
| POST | `/drivers/me/assignment/schedule` | JWT + DriverGuard | Agendar instalação |
| POST | `/drivers/me/assignment/confirm-installation` | JWT + DriverGuard | Confirmar instalação (fotos) |
| POST | `/drivers/me/assignment/submit-periodic-proof` | JWT + DriverGuard | Enviar prova periódica |
| POST | `/drivers/me/assignment/quit` | JWT + DriverGuard | Sair da campanha |
| GET | `/drivers/me/wallet` | JWT + DriverGuard | Saldo e histórico da carteira |
| POST | `/drivers/me/wallet/withdraw` | JWT + DriverGuard | Solicitar saque |
| GET | `/drivers/me/vehicles` | JWT + DriverGuard | Listar veículos |
| GET | `/drivers/me/history` | JWT + DriverGuard | Histórico de campanhas |

## 8. Installers — `installers/installers.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/installers` | JWT + AdminGuard | Criar instalador parceiro |
| GET | `/installers` | JWT | Listar instaladores |

## 9. Positions — `positions/positions.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/positions` | JWT + DriverGuard | Enviar dados GPS (com detecção de fraude) |

## 10. Notifications — `notifications/notifications.controller.ts`

> Todos os endpoints exigem **JWT**

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/notifications/token` | Registrar token de push |
| GET | `/notifications` | Listar notificações |
| PATCH | `/notifications/:id/read` | Marcar como lida |

## 11. Webhooks — `webhooks/webhooks.controller.ts`

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/webhooks/payment` | Público (assinatura Mercado Pago) | Webhook do Mercado Pago |

---

## Resumo por Role

| Role | Qtd | Descrição |
|------|-----|-----------|
| Público | 4 | Auth (signup, verify, refresh) + webhook |
| Autenticado | 3 | Perfil, logout, criar conta |
| Admin | 23 | Gestão completa da plataforma |
| Advertiser | 8 | Campanhas, pagamentos, relatórios |
| Driver | 14 | Candidaturas, provas, carteira, GPS |

---

*Gerado em: 2026-02-09*
